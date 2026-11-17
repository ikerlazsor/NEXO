# 005 — Aviso dentro de la app: que siga el dedo y entre sin rebote

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: MEDIUM
- **Category**: Interruptibility (gestos)
- **Estimated scope**: 1 fichero (`components/InAppToastHost.tsx`), ~60 líneas
- **Depends on**: 001 (`lib/motion.ts`, `scheduleOnRN`)

## Problem

`components/InAppToastHost.tsx` usa el `Animated` antiguo y `PanResponder`:

```ts
// :3-10
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

// :32
const translateY = useRef(new Animated.Value(-120)).current;

// :35-47 dismiss
Animated.timing(translateY, { toValue: -120, duration: 180, useNativeDriver: true })
    .start(() => { setQueue((prev) => prev.slice(1)); });

// :65-79 entrada
translateY.setValue(-120);
Animated.spring(translateY, { toValue: 0, damping: 18, stiffness: 220, useNativeDriver: true }).start();
timerRef.current = setTimeout(dismiss, SHOW_MS);

// :91-98 gesto
const pan = useRef(
    PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && g.dy < 0,
        onPanResponderRelease: (_, g) => {
            if (g.dy < -24 || g.vy < -0.6) dismiss();
        },
    }),
).current;

// :102-110 contenedor
<Animated.View pointerEvents="box-none"
    style={[styles.wrap, { top: Math.max(insets.top, 8) + 6, transform: [{ translateY }] }]}
    {...pan.panHandlers}>
```

1. **El aviso no sigue el dedo.** `PanResponder` no tiene `onPanResponderMove`: al arrastrar hacia arriba el aviso se queda quieto y solo se va al soltar. Parece que no responde.
2. **Rebota al entrar.** damping 18 / stiffness 220 (masa 1) equivale a un ratio de amortiguación de ~0.61: se pasa visiblemente y vuelve. El aviso llega sin que nadie lo haya lanzado; el rebote no tiene motivo.
3. `-120` está fijo: con textos de 2 líneas y la escala de fuente grande, el aviso puede medir más y asomar al "esconderse".
4. Sin movimiento reducido.

## Target

- Reanimated + `Gesture.Pan()`; el aviso sigue el dedo 1:1 hacia arriba y ofrece resistencia hacia abajo.
- Se cierra si al soltar ha subido más de 24px **o** va hacia arriba a más de 500 px/s; si no, vuelve a su sitio con muelle con la velocidad del dedo.
- Entrada: `withTiming(0, { duration: 300, easing: EASE_OUT })` — sin rebote.
- Salida: `withTiming(-(altura + top + 20), { duration: 200, easing: EASE_OUT })`, usando la altura medida con `onLayout`.
- Movimiento reducido: entra y sale con opacidad (200ms) sin desplazamiento.
- Tocar el aviso sigue abriendo el destino (`open`).

```tsx
// target (esqueleto)
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { EASE_OUT, SPRING } from '../lib/motion';

const HIDDEN_Y = -200; // fuera de pantalla hasta medir
const translateY = useSharedValue(HIDDEN_Y);
const opacity = useSharedValue(0);
const hiddenY = useSharedValue(HIDDEN_Y);
const reduced = useReducedMotion();

const popQueue = useCallback(() => setQueue((prev) => prev.slice(1)), []);

const dismiss = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (reduced) {
        opacity.value = withTiming(0, { duration: 200, easing: EASE_OUT }, (f) => { if (f) scheduleOnRN(popQueue); });
        return;
    }
    translateY.value = withTiming(hiddenY.value, { duration: 200, easing: EASE_OUT }, (f) => {
        if (f) scheduleOnRN(popQueue);
    });
}, [reduced, popQueue, opacity, translateY, hiddenY]);

useEffect(() => {
    if (!current) return;
    if (reduced) {
        translateY.value = 0;
        opacity.value = 0;
        opacity.value = withTiming(1, { duration: 200, easing: EASE_OUT });
    } else {
        opacity.value = 1;
        translateY.value = hiddenY.value;
        translateY.value = withTiming(0, { duration: 300, easing: EASE_OUT });
    }
    timerRef.current = setTimeout(dismiss, SHOW_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
}, [current, dismiss, reduced, opacity, translateY, hiddenY]);

const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => { scheduleOnRN(clearDismissTimer); })
    .onUpdate((e) => {
        const dy = e.translationY;
        // hacia arriba libre; hacia abajo con resistencia
        translateY.value = dy < 0 ? dy : dy * 0.2;
    })
    .onEnd((e) => {
        if (translateY.value < -24 || e.velocityY < -500) {
            translateY.value = withTiming(hiddenY.value, { duration: 200, easing: EASE_OUT }, (f) => {
                if (f) scheduleOnRN(popQueue);
            });
        } else {
            translateY.value = withSpring(0, { ...SPRING.snapBack, velocity: e.velocityY });
            scheduleOnRN(restartDismissTimer);
        }
    }), [translateY, hiddenY, popQueue, clearDismissTimer, restartDismissTimer]);

const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
```

`clearDismissTimer` borra `timerRef.current`; `restartDismissTimer` lo vuelve a programar con `setTimeout(dismiss, SHOW_MS)`. Defínelos con `useCallback` antes del gesto. Así el aviso no se va solo mientras el dedo lo sujeta.

Mide la altura con `onLayout` del `Animated.View` y guárdala: `hiddenY.value = -(e.nativeEvent.layout.height + top + 20)`, donde `top = Math.max(insets.top, 8) + 6` (el mismo valor que ya se usa en `:105`).

## Repo conventions to follow

- Gesto de ejemplo en el repo: `components/ChatMessageRow.tsx:372-392` (`Gesture.Pan()` en `useMemo`, offsets de activación, lógica en el hilo de UI).
- `GestureHandlerRootView` ya envuelve la app en `app/_layout.tsx:582`.
- Curvas y muelles desde `lib/motion.ts`.

## Steps

1. Cambia los imports: quita `Animated` y `PanResponder` de `react-native`; añade los de Reanimated, `Gesture`/`GestureDetector`, `scheduleOnRN` y `lib/motion` como en **Target**. Añade `useMemo` al import de `react`.
2. Sustituye `translateY` (`:32`) por los shared values de **Target**.
3. Reescribe `dismiss` (`:34-47`) y el `useEffect` de entrada (`:65-79`) como en **Target**.
4. Añade `clearDismissTimer` y `restartDismissTimer`.
5. Sustituye el `PanResponder` (`:91-98`) por el `Gesture.Pan()` de **Target**.
6. En el JSX (`:102-110`): envuelve el contenedor en `<GestureDetector gesture={pan}>`, cambia el `Animated.View` por el de Reanimated con `style={[styles.wrap, { top }, style]}` y `onLayout` para medir; elimina `{...pan.panHandlers}`.
7. No cambies `open`, el registro de presentadores (`:49-63`) ni los estilos.

## Boundaries

- NO cambies `SHOW_MS`, la cola (`slice(-3)`), ni `lib/inAppToast.ts`.
- NO cambies la vibración de `open` (`hapticMedium`).
- NO cambies el aspecto del aviso (`createToastStyles`).
- Si el `Pressable` interior deja de recibir toques al envolver con `GestureDetector`, prueba primero que `activeOffsetY([-8, 8])` está puesto; si sigue fallando, PARA y repórtalo.

## Verification

- **Mechanical**: `npm run typecheck`; `grep -n "PanResponder\|from 'react-native'.*Animated" components/InAppToastHost.tsx` no devuelve nada.
- **Feel check** (dev build en dispositivo; dispara un aviso con un mensaje de chat desde otra cuenta mientras estás en el feed):
  - Entra desde arriba y se para **sin pasarse**. Grabar y ver a cámara lenta.
  - Ponerle el dedo encima y subir despacio: el aviso sube pegado al dedo. Soltar tras 10px: vuelve a su sitio con suavidad.
  - Un golpe rápido hacia arriba de pocos píxeles: se va.
  - Tirar hacia abajo: se mueve poco (resistencia) y vuelve.
  - Mientras lo sujetas no se cierra solo, aunque pasen más de 5 segundos.
  - Tocarlo: abre el chat.
  - Aviso con dos líneas de texto y tamaño de letra máximo: al irse desaparece del todo, no deja asomar el borde.
  - Con "Reducir movimiento": aparece y desaparece con fundido, sin desplazarse.
- **Done when**: el aviso sigue el dedo, entra sin rebote y se cierra con velocidad o distancia.
