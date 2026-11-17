# 003 — `PressScale` sin vibración por defecto

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: HIGH
- **Category**: Purpose & frequency (haptics)
- **Estimated scope**: 1 fichero obligatorio (+ limpieza opcional en 9), ~3 líneas

## Problem

`components/PressScale.tsx:33-34`, `:58` y `:94`, código actual:

```ts
/** Feedback al empezar a pulsar (default true). */
haptic?: boolean;
// …
haptic = true,
// …
onPressIn={(event) => {
    if (haptic && !disabled) hapticSoft();
```

Cada `PressScale` vibra al empezar a pulsar. Hay 30 usos y solo 9 lo desactivan (`haptic={false}` en `app/(tabs)/index.tsx:1941`, `app/plan/[id].tsx:2112`, `:2127`, `:2302`, `app/rate-plan.tsx:651`, `:826`, `components/MainChrome.tsx:539`, `components/ui/NexoButton.tsx:56`, `features/chat/ChatComposer.tsx:120`). El resto —botón atrás de `ScreenHeader`, filas de `MyPlanListRow`, chips, tarjetas de eventos— vibra en cada toque, decenas de veces al día.

Una vibración debe marcar un evento con significado (confirmar, guardar, unirse). Si todo vibra, la vibración deja de comunicar nada y es lo primero que la gente desactiva. Además, `lib/haptics.ts:21-22` ya tiene que filtrar dobles vibraciones porque `PressScale` y el handler de la acción vibran en el mismo gesto.

El patrón correcto ya existe en el repo: `components/ui/NexoButton.tsx:56-63` desactiva la vibración de `PressScale` y vibra **en `onPress`** según la importancia de la acción:

```ts
haptic={false}
onPress={(e) => {
    if (unavailable) return;
    if (variant === 'danger') hapticWarning();
    else if (variant === 'primary') hapticMedium();
    else hapticSoft();
    onPress?.(e);
}}
```

## Target

- `haptic` pasa a ser `false` por defecto. Quien quiera vibración al pulsar la pide con `haptic` (o, mejor, vibra en su `onPress` como `NexoButton`).
- La escala visual de presión no cambia: sigue siendo la confirmación inmediata del toque.

## Repo conventions to follow

- Ejemplo de vibración bien colocada: `components/ui/NexoButton.tsx:56-63`.
- Helpers en `lib/haptics.ts` (`hapticSoft`, `hapticMedium`, `hapticSuccess`…). No crees otros.

## Steps

1. `components/PressScale.tsx:33`: cambia el comentario a `/** Vibración suave al empezar a pulsar (default false). Mejor vibrar en onPress solo para acciones importantes. */`.
2. `components/PressScale.tsx:58` (`haptic = true,` en la desestructuración): cámbialo a `haptic = false,`.
3. (Opcional, limpieza) Elimina `haptic={false}` en los 9 sitios listados arriba, porque ahora es el valor por defecto. Si dudas, déjalos: no cambian el comportamiento.

## Boundaries

- NO añadas `haptic` a ningún otro sitio en este plan. Si alguna acción importante se queda sin vibrar, anótala en el informe para decidir después.
- NO cambies `lib/haptics.ts` ni `NexoButton.tsx` (salvo el paso 3 opcional).
- NO cambies la escala (`pressedScale`) ni sus tiempos.

## Verification

- **Mechanical**: `npm run typecheck`; `grep -n "haptic = " components/PressScale.tsx` muestra `haptic = false`.
- **Feel check** en un iPhone físico con vibración del sistema activada:
  - Botón atrás de cualquier pantalla, filas de "Mis planes" y chips de eventos: se encogen al pulsar y **no** vibran.
  - Botones principales (`NexoButton` primario, p. ej. "Unirme"/"Enviar"): siguen vibrando al soltar.
  - Guardar un plan con el corazón y responder deslizando en el chat siguen vibrando (tienen su propia vibración).
- **Done when**: el default es `false` y solo vibran las acciones que llaman a un helper de `lib/haptics.ts` desde su handler.
