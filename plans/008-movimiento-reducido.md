# 008 — Respetar "Reducir movimiento" en las animaciones decorativas y de entrada

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 6 ficheros, ~5–10 líneas cada uno

## Problem

Solo `components/PressScale.tsx:65` consulta `useReducedMotion()`. Estas animaciones se desplazan, escalan o giran sin tenerlo en cuenta:

| Ubicación | Movimiento |
| --- | --- |
| `components/HeartRain.tsx:68-83` | 16 corazones que suben, giran y escalan |
| `components/FeedHeartBurstHost.tsx:81-108` | 26 corazones en explosión radial a pantalla completa |
| `components/LaunchRevealHost.tsx:75-79` | logo escala a 1.22 y el feed hace zoom de 1.035 a 1 |
| `components/OnboardingReadyReveal.tsx:52-59` | pulso infinito de escala del avatar |
| `components/ChatMessageRow.tsx:352-360` | el mensaje enviado sube 14px |
| `app/(tabs)/index.tsx:341-350` | el feed baja 12px y sube tras refrescar |
| `app/(tabs)/index.tsx:444-447` | filtros flotantes bajan 14px al aparecer |

Código actual relevante:

```ts
// components/HeartRain.tsx:68-70
export function HeartRain({ burstKey, color = '#EF4444' }: Props) {
    const [particles, setParticles] = useState<Particle[]>([]);
    useEffect(() => {
        if (!burstKey) return;

// components/FeedHeartBurstHost.tsx:81-84
export function FeedHeartBurstHost() {
    const [bursts, setBursts] = useState<Burst[]>([]);
    useEffect(() => {
        return subscribeHeartBurst((evt) => {

// components/LaunchRevealHost.tsx:75-79
feedScale.value = 1.035;
logoScale.value = withTiming(1.22, { duration: 560, easing: smooth });
logoOpacity.value = withDelay(90, withTiming(0, { duration: 400, easing: fade }));
bgOpacity.value = withDelay(60, withTiming(0, { duration: 460, easing: fade }));
feedScale.value = withDelay(60, withTiming(1, { duration: 560, easing: smooth }));

// components/OnboardingReadyReveal.tsx:52-59
useEffect(() => {
    pulse.value = withRepeat(
        withSequence(
            withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
            withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
    );
}, [pulse]);

// components/ChatMessageRow.tsx:328-329
const enterOpacity = useSharedValue(enterOnce.current ? 0 : 1);
const enterY = useSharedValue(enterOnce.current ? 14 : 0);

// app/(tabs)/index.tsx:347-350
const feedFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(feedFade.value, [0, 1], [0.5, 1]),
    transform: [{ translateY: interpolate(feedFade.value, [0, 1], [12, 0]) }],
}));

// app/(tabs)/index.tsx:444-447
const stickyFiltersStyle = useAnimatedStyle(() => ({
    opacity: stickyFilters.value,
    transform: [{ translateY: interpolate(stickyFilters.value, [0, 1], [-14, 0]) }],
}));
```

## Target

"Reducir movimiento" significa **menos y más suave, no cero**: se mantienen opacidad y color (explican el cambio de estado) y se quitan desplazamiento, escala, giro y bucles.

| Ubicación | Con movimiento reducido |
| --- | --- |
| `HeartRain` | no genera partículas (el corazón que se rellena ya comunica el cambio) |
| `FeedHeartBurstHost` | ignora el evento: no genera explosión |
| `LaunchRevealHost` | `logoScale` y `feedScale` se quedan en 1; las opacidades se animan igual |
| `OnboardingReadyReveal` | sin bucle de pulso (`pulse` se queda en 0) |
| `ChatMessageRow` (envío) | `enterY` empieza en 0; la opacidad sí se anima |
| `index.tsx` feed tras refrescar | sin `translateY`; la opacidad se anima |
| `index.tsx` filtros flotantes | sin `translateY`; la opacidad se anima |

## Repo conventions to follow

- Ejemplo a imitar: `components/PressScale.tsx:65` y `:70`, `:97`, `:100`:
  ```ts
  const reducedMotion = useReducedMotion();
  // …
  if (reducedMotion || disabled) return;
  ```
- `useReducedMotion` se importa de `react-native-reanimated`.
- Un booleano de React (`reduced`) puede leerse dentro de `useAnimatedStyle`: Reanimated lo captura en el worklet. Inclúyelo en las dependencias cuando las haya.

## Steps

1. **`components/HeartRain.tsx`**: importa `useReducedMotion` de Reanimated. En `HeartRain`, `const reduced = useReducedMotion();` y cambia la guarda del efecto a `if (!burstKey || reduced) return;`. Añade `reduced` a las dependencias del `useEffect`.
2. **`components/FeedHeartBurstHost.tsx`**: importa `useReducedMotion`. En `FeedHeartBurstHost`, `const reduced = useReducedMotion();`. Dentro del callback de `subscribeHeartBurst`, primera línea: `if (reduced) return;`. Añade `reduced` a las dependencias del `useEffect`.
3. **`components/LaunchRevealHost.tsx`**: importa `useReducedMotion`; `const reduced = useReducedMotion();` dentro del componente, junto a los shared values (`:57-60`). En `beginFadeOut` (`:68-87`):
   - cambia `feedScale.value = 1.035;` por `feedScale.value = reduced ? 1 : 1.035;`
   - cambia `logoScale.value = withTiming(1.22, …)` por `if (!reduced) logoScale.value = withTiming(1.22, { duration: 560, easing: smooth });`
   - cambia `feedScale.value = withDelay(60, withTiming(1, …))` por `if (!reduced) feedScale.value = withDelay(60, withTiming(1, { duration: 560, easing: smooth }));`
   - añade `reduced` a las dependencias del `useCallback`.
   No cambies las curvas `smooth`/`fade` ni las opacidades.
4. **`components/OnboardingReadyReveal.tsx`**: importa `useReducedMotion`; `const reduced = useReducedMotion();`. En el efecto de `:52-59` añade al principio `if (reduced) { pulse.value = 0; return; }` y añade `reduced` a las dependencias.
5. **`components/ChatMessageRow.tsx`**: importa `useReducedMotion`; en `NormalChatMessageRow`, `const reduced = useReducedMotion();` antes de `:328`. Cambia `:329` a `const enterY = useSharedValue(enterOnce.current && !reduced ? 14 : 0);` y en el efecto de `:352-360` cambia la línea de `enterY` a `if (!reduced) enterY.value = withTiming(0, { duration: 260, easing: SEND_ENTER_EASING });`.
6. **`app/(tabs)/index.tsx`**: importa `useReducedMotion` en el import de Reanimated; `const reducedMotion = useReducedMotion();` cerca de `feedFade` (`:341`). En `feedFadeStyle` (`:347-350`): `translateY: reducedMotion ? 0 : interpolate(feedFade.value, [0, 1], [12, 0])`. En `stickyFiltersStyle` (`:444-447`): `translateY: reducedMotion ? 0 : interpolate(stickyFilters.value, [0, 1], [-14, 0])`.

## Boundaries

- NO toques los paneles (filtros, mapa): su desplazamiento explica de dónde vienen y se tratan en otros planes.
- NO toques `PressScale` (ya cumple), `PlanCard` (plan 004), `InAppToastHost` (plan 005) ni `SkeletonShimmer` (plan 010).
- NO cambies duraciones ni curvas cuando el movimiento NO está reducido.
- Si una línea citada no coincide, PARA y repórtalo.

## Verification

- **Mechanical**: `npm run typecheck`; `npm run lint` (sin avisos nuevos de dependencias de hooks).
- **Feel check** con "Reducir movimiento" ACTIVADO (iOS: Ajustes › Accesibilidad › Movimiento; Android: Ajustes › Accesibilidad › Quitar animaciones):
  - Guardar un plan en el feed y en el detalle: el corazón cambia de estado, sin lluvia ni explosión.
  - Arranque en frío: el splash se desvanece sin que el logo crezca ni el feed haga zoom.
  - Final del onboarding: el avatar no late.
  - Enviar un mensaje: aparece con fundido, sin subir.
  - Tirar para refrescar el feed y hacer scroll hacia arriba: feed y filtros aparecen con fundido, sin moverse.
- **Feel check** con el ajuste DESACTIVADO: todo se ve exactamente igual que antes.
- **Done when**: las 7 ubicaciones de la tabla cumplen su columna "Con movimiento reducido".
