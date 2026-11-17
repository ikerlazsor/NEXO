# 002 — Cerrar el panel del mapa con salida rápida en vez de `Easing.in`

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: HIGH
- **Category**: Easing & duration
- **Estimated scope**: 1 fichero, ~3 líneas
- **Depends on**: 001 (usa `EASE_OUT` de `lib/motion.ts`)

## Problem

`components/FeedMapHost.tsx:237-241`, código actual:

```ts
sheetY.value = withTiming(
    SHEET_HIDDEN_Y,
    { duration: 280, easing: Easing.in(Easing.cubic) },
    (finished) => { if (finished) runOnJS(onSheetClosed)(); },
);
```

(Si el plan 001 ya se ejecutó, la última línea dirá `scheduleOnRN(onSheetClosed)`; es lo esperado.)

`Easing.in` arranca lento: durante los primeros ~100ms el panel casi no se mueve, justo cuando el usuario espera la respuesta a su toque. Además, el comentario de `:234-235` explica que el detalle del plan **no se abre hasta que termina** este cierre (`onSheetClosed` → `finishDismiss` → `router.push`), así que los 280ms con arranque lento se suman directamente al tiempo hasta ver el plan. Se ejecuta cada vez que alguien toca un plan desde el mapa.

## Target

```ts
sheetY.value = withTiming(
    SHEET_HIDDEN_Y,
    { duration: 220, easing: EASE_OUT },   // EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
    (finished) => { if (finished) scheduleOnRN(onSheetClosed); },
);
```

Con salida fuerte, el panel recorre la mayor parte del trayecto en los primeros ~80ms y el detalle se abre 60ms antes.

## Repo conventions to follow

- Importar la curva desde `lib/motion.ts`: `import { EASE_OUT } from '../lib/motion';`
- Ejemplo de entrada correcta en el mismo fichero: `:253-257` (`Easing.out(Easing.cubic)`, que no debes cambiar).

## Steps

1. En `components/FeedMapHost.tsx` añade `import { EASE_OUT } from '../lib/motion';`.
2. En la línea 239 cambia `{ duration: 280, easing: Easing.in(Easing.cubic) }` por `{ duration: 220, easing: EASE_OUT }`.
3. Deja el callback como esté (con `runOnJS` o con `scheduleOnRN`, según si se ejecutó 001).

## Boundaries

- NO cambies la apertura (`:253-257`), ni `revealMap` (`:160`), ni el aparcado instantáneo (`:427`).
- NO cambies el orden "primero cierra, luego abre el detalle": es una decisión documentada (`:234-235`).
- NO elimines `Easing` del import: se sigue usando en `:255`.

## Verification

- **Mechanical**: `npm run typecheck`; `grep -n "Easing.in(" components/FeedMapHost.tsx` no devuelve nada.
- **Feel check** (build de release o dev build en un Android modesto):
  - Abrir el mapa desde el feed y tocar un plan del carrusel: el panel debe empezar a bajar en el mismo frame del toque, sin "pausa" inicial.
  - El detalle del plan aparece justo después de que el panel sale; no se solapan.
  - Grabar la pantalla y verla a cámara lenta: el panel debe ir rápido al principio y frenar al final, nunca al revés.
- **Done when**: no queda `Easing.in` en el fichero y el cierre dura 220ms con `EASE_OUT`.
