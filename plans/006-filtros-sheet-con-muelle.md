# 006 — Panel de filtros: soltar con muelle que conserva la velocidad del dedo

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 fichero (`app/(tabs)/index.tsx`), ~25 líneas en `:240-316`
- **Depends on**: 001 (`lib/motion.ts`, `scheduleOnRN`)

## Problem

`app/(tabs)/index.tsx:281-316`, gesto actual:

```ts
const filtersPanGesture = useMemo(
    () =>
        Gesture.Pan()
            .activeOffsetY(8)
            .failOffsetX([-32, 32])
            .onUpdate((e) => {
                if (filtersClosing.value) return;
                filtersSheetY.value = Math.max(0, e.translationY);
            })
            .onEnd((e) => {
                if (filtersClosing.value) return;
                const dismiss = filtersSheetY.value > 100 || e.velocityY > 900;
                if (dismiss) {
                    filtersClosing.value = 1;
                    const progress = Math.min(1, filtersSheetY.value / Math.max(1, filtersSheetHeight));
                    const duration = Math.round(200 + (1 - progress) * 100);
                    cancelAnimation(filtersSheetY);
                    filtersSheetY.value = withTiming(
                        filtersSheetHeight,
                        { duration, easing: Easing.inOut(Easing.cubic) },
                        (finished) => {
                            if (finished) runOnJS(finishCloseFiltersModal)();
                        },
                    );
                } else {
                    filtersSheetY.value = withTiming(0, {
                        duration: 240,
                        easing: Easing.out(Easing.cubic),
                    });
                }
            }),
    [finishCloseFiltersModal, filtersClosing, filtersSheetHeight, filtersSheetY],
);
```

Y el cierre por botón/fondo en `:240-250`:
```ts
filtersSheetY.value = withTiming(
    filtersSheetHeight,
    { duration: 260, easing: Easing.inOut(Easing.cubic) },
    (finished) => { if (finished) runOnJS(finishCloseFiltersModal)(); },
);
```

(Si el plan 001 ya se ejecutó, `runOnJS(finishCloseFiltersModal)()` se leerá `scheduleOnRN(finishCloseFiltersModal)`.)

1. **Al soltar se pierde la velocidad.** `withTiming` con `Easing.inOut` arranca lento: si lanzas el panel hacia abajo rápido, al soltar **frena** y luego acelera. Se nota un tirón justo al levantar el dedo.
2. **Volver a su sitio** también ignora la velocidad.
3. **Tope seco arriba**: `Math.max(0, …)` deja el panel clavado si tiras hacia arriba; debería resistirse.
4. No hay `onStart` que capture el valor actual: si agarras el panel mientras todavía está subiendo, salta a la posición del dedo desde 0.
5. El cierre con botón usa `Easing.inOut` (arranque lento) para una salida.

## Target

- Cerrar al soltar: `withSpring(filtersSheetHeight, { ...SPRING.sheet, velocity: e.velocityY, overshootClamping: true }, cb)` — `SPRING.sheet = { duration: 300, dampingRatio: 0.8 }`.
- Volver a su sitio: `withSpring(0, { ...SPRING.sheet, velocity: e.velocityY })`.
- Hacia arriba: resistencia elástica con `rubberband` (abajo).
- `onStart`: cancelar la animación en curso y guardar la posición actual.
- Cierre por botón/fondo: `withTiming(filtersSheetHeight, { duration: 240, easing: EASE_SHEET }, cb)` — `EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1)`.
- Mantener la regla actual de cierre (`> 100px` o `velocityY > 900`).

```ts
// Añadir a nivel de módulo (fuera del componente)
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
    'worklet';
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
```

```ts
// target del gesto
const filtersDragStart = useSharedValue(0);

const filtersPanGesture = useMemo(
    () =>
        Gesture.Pan()
            .activeOffsetY(8)
            .failOffsetX([-32, 32])
            .onStart(() => {
                if (filtersClosing.value) return;
                cancelAnimation(filtersSheetY);
                filtersDragStart.value = filtersSheetY.value;
            })
            .onUpdate((e) => {
                if (filtersClosing.value) return;
                const next = filtersDragStart.value + e.translationY;
                filtersSheetY.value = next >= 0 ? next : rubberband(next, filtersSheetHeight);
            })
            .onEnd((e) => {
                if (filtersClosing.value) return;
                const dismiss = filtersSheetY.value > 100 || e.velocityY > 900;
                if (dismiss) {
                    filtersClosing.value = 1;
                    filtersSheetY.value = withSpring(
                        filtersSheetHeight,
                        { ...SPRING.sheet, velocity: e.velocityY, overshootClamping: true },
                        (finished) => {
                            if (finished) scheduleOnRN(finishCloseFiltersModal);
                        },
                    );
                } else {
                    filtersSheetY.value = withSpring(0, { ...SPRING.sheet, velocity: e.velocityY });
                }
            }),
    [finishCloseFiltersModal, filtersClosing, filtersDragStart, filtersSheetHeight, filtersSheetY],
);
```

## Repo conventions to follow

- Shared values con `.value` (convención del repo).
- Curvas y muelles desde `lib/motion.ts` (`SPRING`, `EASE_SHEET`).
- El fondo ya se deriva de `filtersSheetY` (`:273-280`); no hace falta tocarlo.

## Steps

1. Añade `withSpring` al import de `react-native-reanimated` (`:34-43`) y `import { EASE_SHEET, SPRING } from '../../lib/motion';`. Si 001 no se ejecutó, importa también `scheduleOnRN` de `react-native-worklets`.
2. Añade la función `rubberband` a nivel de módulo, encima del componente.
3. Junto a `filtersSheetY` (`:220-222`) añade `const filtersDragStart = useSharedValue(0);`.
4. Sustituye `filtersPanGesture` (`:281-316`) por el de **Target**.
5. En `closeFiltersModal` (`:244-250`) cambia `{ duration: 260, easing: Easing.inOut(Easing.cubic) }` por `{ duration: 240, easing: EASE_SHEET }`.
6. Si `Easing` ya no se usa en el fichero, quítalo del import. (En `bc6f0c7` sigue usándose en `:264`, `:345`, `:424`, así que debería quedarse.)

## Boundaries

- NO cambies la apertura (`:259-266`), la altura (`:223`), el fondo (`:273-280`) ni `finishCloseFiltersModal`.
- NO conviertas el panel en `presentation: 'formSheet'`: vive dentro del `Modal` del feed (`:2162`) y cambiarlo es otro trabajo.
- NO cambies el contenido del panel.

## Verification

- **Mechanical**: `npm run typecheck`; `npm run lint`.
- **Feel check** (dev build en un Android modesto y en iPhone):
  - Lanzar el panel hacia abajo con un golpe rápido: sigue a la misma velocidad que llevaba el dedo y se va, **sin frenazo** al soltar. Grabar a cámara lenta para confirmarlo.
  - Arrastrar 60px despacio y soltar: vuelve arriba con suavidad, un pelín de rebote como mucho.
  - Tirar hacia arriba: el panel se mueve cada vez menos (resistencia), y al soltar vuelve.
  - Abrir el panel y agarrarlo antes de que termine de subir: no salta; continúa desde donde estaba.
  - Al cerrarse, no asoma un hueco por debajo (no hay rebote más allá del borde).
  - Cerrar con el botón o tocando el fondo: empieza a bajar sin pausa.
- **Done when**: los dos finales del gesto usan `withSpring` con `velocity` y el tope superior tiene resistencia.
