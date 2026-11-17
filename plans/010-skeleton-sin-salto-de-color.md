# 010 — Skeleton: pulso continuo sin salto de color, y quieto con movimiento reducido

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: LOW
- **Category**: Cohesion (pulido) / Accessibility
- **Estimated scope**: 1 fichero (`components/SkeletonShimmer.tsx`), ~10 líneas

## Problem

`components/SkeletonShimmer.tsx:21-39`, código actual:

```ts
function Bone({ width, height, radius = 10, style }: BoneProps) {
    const { colors } = useAppTheme();
    const BASE = colors.surfaceSubtle;
    const HIGHLIGHT = colors.border;
    const t = useSharedValue(0);

    useEffect(() => {
        t.value = withRepeat(
            withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
        );
    }, [t]);

    const animStyle = useAnimatedStyle(() => ({
        opacity: interpolate(t.value, [0, 1], [0.55, 1]),
        backgroundColor: t.value > 0.5 ? HIGHLIGHT : BASE,
    }));
```

1. `backgroundColor: t.value > 0.5 ? HIGHLIGHT : BASE` cambia el color **de golpe** a mitad de cada pulso, mientras la opacidad sube suave. Se ve un pequeño parpadeo cada 1,1s en todas las pantallas de carga (feed, chats, perfil, ajustes).
2. El bucle infinito no respeta "Reducir movimiento".

## Target

```ts
import Animated, {
    Easing,
    interpolate,
    interpolateColor,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

function Bone({ width, height, radius = 10, style }: BoneProps) {
    const { colors } = useAppTheme();
    const BASE = colors.surfaceSubtle;
    const HIGHLIGHT = colors.border;
    const t = useSharedValue(0);
    const reduced = useReducedMotion();

    useEffect(() => {
        if (reduced) {
            t.value = 0.5;
            return;
        }
        t.value = withRepeat(
            withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
        );
    }, [t, reduced]);

    const animStyle = useAnimatedStyle(() => ({
        opacity: interpolate(t.value, [0, 1], [0.55, 1]),
        backgroundColor: interpolateColor(t.value, [0, 1], [BASE, HIGHLIGHT]),
    }));
```

- El color pasa de `BASE` a `HIGHLIGHT` de forma continua, a la vez que la opacidad.
- Con movimiento reducido, el hueso se queda quieto en el punto medio (sigue indicando "cargando" por su forma).
- `Easing.inOut(Easing.quad)` es correcto aquí: es un vaivén continuo, no una entrada.

## Repo conventions to follow

- `useReducedMotion` como en `components/PressScale.tsx:65`.

## Steps

1. Añade `interpolateColor` y `useReducedMotion` al import de `react-native-reanimated` (`:5-12`).
2. En `Bone`, añade `const reduced = useReducedMotion();` y sustituye el `useEffect` (`:27-33`) por el del **Target**.
3. En `animStyle` (`:35-38`) cambia la línea de `backgroundColor` por `backgroundColor: interpolateColor(t.value, [0, 1], [BASE, HIGHLIGHT]),`.

## Boundaries

- NO cambies duraciones, opacidades ni los esqueletos (`FeedSkeletonList`, etc.).
- NO añadas un brillo que se desplaza: el pulso actual está bien.

## Verification

- **Mechanical**: `npm run typecheck`.
- **Feel check** (dev build; forzar carga con conexión lenta o borrando la caché del feed):
  - Mirar fijamente un skeleton del feed durante 5 segundos: el pulso es continuo, sin ningún "clic" de color a mitad.
  - Repetir en modo oscuro: el color se mezcla igual de suave.
  - Con "Reducir movimiento" activado: los huesos se ven quietos, con un gris intermedio.
- **Done when**: `backgroundColor` usa `interpolateColor` y el bucle no arranca con movimiento reducido.
