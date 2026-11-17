# 004 — Presión de `PlanCard` con Reanimated, sin rebote, y sin la entrada muerta

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: MEDIUM
- **Category**: Physicality & origin / Performance
- **Estimated scope**: 1 fichero (`components/PlanCard.tsx`), ~30 líneas

## Problem

La tarjeta del feed es lo que más se toca de la app (decenas de veces al día). Su animación usa el `Animated` antiguo de React Native en vez de Reanimated, y al soltar rebota sin que haya habido impulso.

`components/PlanCard.tsx:11-15` (import):
```ts
import {
    Animated,
    Dimensions,
    Easing,
    // …
} from 'react-native';
```

`:275-290` — entrada que **nunca se ejecuta** (ningún sitio pasa `animateEntrance`; el default `animateEntrance = false` en `:262` hace que siempre se llame a `entrance.setValue(1)`):
```ts
const entrance = useRef(new Animated.Value(0)).current;
const scale = useRef(new Animated.Value(1)).current;

useEffect(() => {
    if (!animateEntrance || index > 4) {
        entrance.setValue(1);
        return;
    }
    Animated.timing(entrance, {
        toValue: 1,
        duration: 320,
        delay: Math.min(index, 4) * 50,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
    }).start();
}, [animateEntrance, entrance, index]);
```

`:379-389` — presión:
```ts
const pressIn = () => {
    Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
    // Empieza a calentar detalle + torneo mientras baja el dedo.
    // … (prefetch, NO tocar)
};
const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
```

`:609` — contenedor:
```tsx
<Animated.View style={{ opacity: entrance, transform: [{ scale }, { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
```
y su cierre en `:1117` `</Animated.View>`.

Problemas:
1. `bounciness: 6` al soltar: la tarjeta se pasa de 1 y vuelve. Un rebote solo tiene sentido si el gesto llevaba impulso; una pulsación no lo lleva.
2. Además, la entrada sería una animación en una fila de `FlashList` (`app/(tabs)/index.tsx:2044`): las filas se reciclan y la entrada volvería a dispararse al hacer scroll. Como nadie la activa, es código muerto que conviene borrar para que nadie la active.
3. El resto de la app usa Reanimated y `PressScale` (`components/PressScale.tsx`) para lo mismo, con otros tiempos: dos sensaciones distintas de presión.

## Target

- Escala de presión con Reanimated, misma sensación que `PressScale`: pulsar → `0.98` en 55ms con `EASE_OUT`; soltar → `1` en 110ms con `EASE_OUT`; sin rebote.
- Con movimiento reducido del sistema: sin escala.
- Sin animación de entrada ni prop `animateEntrance`.

```tsx
// target (fragmentos)
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { DURATION, EASE_OUT } from '../lib/motion';

const pressScale = useSharedValue(1);
const reducedMotion = useReducedMotion();
const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));

const pressIn = () => {
    if (!reducedMotion) pressScale.value = withTiming(0.98, { duration: DURATION.pressIn, easing: EASE_OUT });
    // … prefetch existente sin cambios
};
const pressOut = () => {
    pressScale.value = reducedMotion ? 1 : withTiming(1, { duration: DURATION.pressOut, easing: EASE_OUT });
};

return (
    <Reanimated.View style={pressStyle}>
        {/* … contenido sin cambios … */}
    </Reanimated.View>
);
```

Se importa como `Reanimated` porque `Animated` ya se llama así en el import de `react-native`; tras este plan ese `Animated` desaparece del fichero, pero usar `Reanimated` evita confusiones.

## Repo conventions to follow

- Ejemplo a imitar: `components/PressScale.tsx:63-101` (shared value + `withTiming` + `useReducedMotion`).
- Curvas y duraciones desde `lib/motion.ts` (creado en el plan 001).

## Steps

1. Import de `react-native` (`:11-23`): elimina `Animated` y `Easing` (comprueba con búsqueda que no se usan en otra parte del fichero; en el commit `bc6f0c7` solo se usan en las líneas citadas).
2. Añade:
   ```ts
   import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
   import { DURATION, EASE_OUT } from '../lib/motion';
   ```
3. Borra `animateEntrance?: boolean;` del tipo de props (≈`:236`) y `animateEntrance = false,` de la desestructuración (`:262`). **No** borres `index`: se usa en `:685`.
4. Sustituye `:275-290` (las dos refs y el `useEffect` de entrada) por:
   ```ts
   const pressScale = useSharedValue(1);
   const reducedMotion = useReducedMotion();
   const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
   ```
5. En `pressIn` (`:379-380`) sustituye la línea `Animated.spring(scale, …).start();` por
   `if (!reducedMotion) pressScale.value = withTiming(0.98, { duration: DURATION.pressIn, easing: EASE_OUT });`
   Deja intacto el resto de `pressIn` (prefetch).
6. Sustituye `pressOut` (`:389`) por:
   ```ts
   const pressOut = () => {
       pressScale.value = reducedMotion ? 1 : withTiming(1, { duration: DURATION.pressOut, easing: EASE_OUT });
   };
   ```
7. `:609`: `<Animated.View style={{ opacity: entrance, transform: … }}>` → `<Reanimated.View style={pressStyle}>`. `:1117`: `</Animated.View>` → `</Reanimated.View>`.

## Boundaries

- NO toques el prefetch de `pressIn`, ni `onPress`, ni la estructura del contenido de la tarjeta.
- NO cambies los otros componentes que usan `PlanCard` (`app/(tabs)/index.tsx`, `app/saved-plans.tsx`, `app/agenda-preview.tsx`); ninguno pasa `animateEntrance`. Si alguno lo pasa, PARA y repórtalo.
- NO sustituyas la `Pressable` por `PressScale` (cambiaría el área táctil y añadiría `minTouch`).
- NO añadas dependencias.

## Verification

- **Mechanical**: `npm run typecheck`; `grep -n "Animated\.\(timing\|spring\|Value\)\|animateEntrance" components/PlanCard.tsx` no devuelve nada.
- **Feel check** (dev build en dispositivo):
  - Mantener pulsada una tarjeta del feed: se encoge un 2% casi al instante.
  - Soltar sin abrir (arrastrando para hacer scroll): vuelve a 1 **sin pasarse**. Grabar a cámara lenta y comprobar que nunca supera el tamaño original.
  - Hacer scroll rápido arriba y abajo por el feed: ninguna tarjeta aparece con fundido ni desplazamiento.
  - Con "Reducir movimiento" activado (iOS Ajustes › Accesibilidad › Movimiento): la tarjeta no escala y se sigue abriendo.
- **Done when**: no queda `Animated` de `react-native` en `PlanCard.tsx` y la presión no rebota.
