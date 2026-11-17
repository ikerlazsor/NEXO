# 001 — Crear `lib/motion.ts` con curvas compartidas y migrar `runOnJS` a `scheduleOnRN`

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: LOW (pero es la base de 002, 004, 005, 006 y 011 — ejecutar primero)
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 fichero nuevo + 4 ficheros editados, ~40 líneas

## Problem

No existe un sitio con las curvas y duraciones de la app. Cada componente escribe la suya:

- `Easing.out(Easing.cubic)` aparece en `app/(tabs)/index.tsx:264`, `:311`, `:345`, `:424`, `components/FeedMapHost.tsx:255`, `components/HeartRain.tsx:56`, `components/FeedHeartBurstHost.tsx:59`, `lib/chatKeyboard.ts:78`.
- `Easing.bezier(0.17, 0.59, 0.4, 0.99)` está duplicada en `components/ChatMessageRow.tsx:285` y `lib/chatKeyboard.ts:16`.
- `Easing.bezier(0.33, 0, 0.2, 1)` y `Easing.bezier(0.4, 0, 0.6, 1)` en `components/LaunchRevealHost.tsx:73-74`.
- `components/PressScale.tsx:45-46` define `PRESS_IN` / `PRESS_OUT` localmente.

Además, `runOnJS` está obsoleto en Reanimated 4 (el proyecto usa `react-native-reanimated` 4.1.6 + `react-native-worklets` 0.5.1). Usos actuales:

```ts
// app/(tabs)/index.tsx:39, :248, :305
runOnJS,
if (finished) runOnJS(finishCloseFiltersModal)();
// components/ChatMessageRow.tsx:10, :388
runOnJS,
runOnJS(fireReply)();
// components/FeedMapHost.tsx:19, :240, :256, :428
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
(finished) => { if (finished) runOnJS(onSheetClosed)(); },
(finished) => { if (finished) runOnJS(onSheetOpened)(); },
if (finished) runOnJS(setRaised)(true);
// components/LaunchRevealHost.tsx:6, :83
runOnJS,
if (finished) runOnJS(completeReveal)();
```

## Target

Un módulo `lib/motion.ts` con exactamente estos valores:

```ts
import { Easing } from 'react-native-reanimated';

/** Salida fuerte para UI: entradas, salidas y respuestas. Nunca usar Easing.in en UI. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Movimiento de algo que ya está en pantalla. */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** Curva de sheet estilo iOS. */
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);

export const DURATION = {
    pressIn: 55,
    pressOut: 110,
    small: 180,
    sheet: 300,
} as const;

/** Muelles estilo Apple (duration + dampingRatio). Pasar `velocity` del gesto al usarlos. */
export const SPRING = {
    settle: { duration: 400, dampingRatio: 1 },
    snapBack: { duration: 400, dampingRatio: 0.8 },
    sheet: { duration: 300, dampingRatio: 0.8 },
} as const;
```

Y todas las llamadas `runOnJS(fn)(...args)` reescritas como `scheduleOnRN(fn, ...args)`, importando `scheduleOnRN` de `react-native-worklets`.

## Repo conventions to follow

- Helpers compartidos viven en `lib/` (p. ej. `lib/haptics.ts`, `lib/chatKeyboard.ts`). Comentarios en español.
- El repo escribe shared values con `.value`; no cambies eso en este plan.

## Steps

1. Crea `lib/motion.ts` con el contenido exacto de **Target**.
2. `components/PressScale.tsx:45-46`: sustituye
   ```ts
   const PRESS_IN = { duration: 55, easing: Easing.out(Easing.quad) };
   const PRESS_OUT = { duration: 110, easing: Easing.out(Easing.cubic) };
   ```
   por
   ```ts
   const PRESS_IN = { duration: DURATION.pressIn, easing: EASE_OUT };
   const PRESS_OUT = { duration: DURATION.pressOut, easing: EASE_OUT };
   ```
   añade `import { DURATION, EASE_OUT } from '../lib/motion';` y elimina `Easing` del import de Reanimated si ya no se usa en el fichero.
3. `app/(tabs)/index.tsx`: en el import de `react-native-reanimated` (líneas 34-43) elimina `runOnJS`; añade `import { scheduleOnRN } from 'react-native-worklets';`. Cambia las líneas 248 y 305 de `runOnJS(finishCloseFiltersModal)();` a `scheduleOnRN(finishCloseFiltersModal);`.
4. `components/ChatMessageRow.tsx`: elimina `runOnJS` del import (línea 10), añade `import { scheduleOnRN } from 'react-native-worklets';`, cambia la línea 388 `runOnJS(fireReply)();` → `scheduleOnRN(fireReply);`.
5. `components/FeedMapHost.tsx`: elimina `runOnJS` del import de la línea 19, añade el import de `scheduleOnRN`, y cambia:
   - `:240` `runOnJS(onSheetClosed)()` → `scheduleOnRN(onSheetClosed)`
   - `:256` `runOnJS(onSheetOpened)()` → `scheduleOnRN(onSheetOpened)`
   - `:428` `runOnJS(setRaised)(true)` → `scheduleOnRN(setRaised, true)`
6. `components/LaunchRevealHost.tsx`: elimina `runOnJS` del import (línea 6), añade el import de `scheduleOnRN`, cambia la línea 83 `runOnJS(completeReveal)()` → `scheduleOnRN(completeReveal)`.

## Boundaries

- NO cambies ninguna otra curva ni duración en este plan: los planes 002, 004, 005, 006 y 011 lo harán usando este módulo.
- NO toques `LaunchRevealHost.tsx:73-74` (las curvas del splash son deliberadas, ver comentario en `:70-72`).
- NO añadas dependencias: `react-native-worklets` ya está en `package.json` (0.5.1).
- Si `scheduleOnRN` no existe en `react-native-worklets` (error de tipos al importarlo), PARA y repórtalo; no vuelvas a `runOnJS`.
- Si el código no coincide con los fragmentos de arriba, PARA y repórtalo.

## Verification

- **Mechanical**: `npm run typecheck` sin errores nuevos; `npm run lint` sin errores nuevos; `grep -rn "runOnJS" app components lib features` no devuelve nada.
- **Feel check** (build de desarrollo en dispositivo, no Expo Go):
  - Abrir y cerrar el panel de filtros del feed (botón y arrastre): se cierra y el modal desaparece.
  - Abrir el mapa del feed, cerrar el panel tocando un plan: se abre el detalle al terminar.
  - Deslizar un mensaje del chat a la derecha más de 44px: se activa responder y vibra.
  - Lanzar la app en frío hasta el feed: el splash desaparece y el overlay se retira.
  - Pulsar botones: la escala de presión se nota igual o algo más ágil que antes.
- **Done when**: existe `lib/motion.ts`, no queda `runOnJS` en el repo y las cuatro interacciones de arriba funcionan.
