# 011 — Responder deslizando: vibrar al cruzar el umbral, no al soltar

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: LOW (oportunidad)
- **Category**: Missed opportunities (haptics)
- **Estimated scope**: 1 fichero (`components/ChatMessageRow.tsx`), ~15 líneas
- **Depends on**: 001 (`scheduleOnRN`)

## Problem

`components/ChatMessageRow.tsx:362-392`, código actual:

```ts
const fireReply = useCallback(() => {
    hapticMedium();
    onReplyRef.current(itemIdRef.current);
}, []);

const pan = useMemo(
    () =>
        Gesture.Pan()
            .activeOffsetX(16)
            .failOffsetY([-16, 16])
            .onBegin(() => {
                crossedReplyRef.value = false;
            })
            .onUpdate((e) => {
                const x = Math.max(0, Math.min(e.translationX, MAX_DRAG));
                translateX.value = x;
                if (x >= REPLY_THRESHOLD) {
                    crossedReplyRef.value = true;
                }
            })
            .onFinalize(() => {
                const shouldReply = crossedReplyRef.value;
                crossedReplyRef.value = false;
                translateX.value = withSpring(0, REPLY_SPRING);
                if (shouldReply) {
                    runOnJS(fireReply)();
                }
            }),
    [crossedReplyRef, fireReply, translateX],
);
```

(Tras el plan 001, `runOnJS(fireReply)()` se lee `scheduleOnRN(fireReply)`.)

La vibración llega al **soltar**. Mientras el dedo arrastra, el usuario no sabe si ya ha pasado los 44px (`REPLY_THRESHOLD`, `:38`): suelta "a ver si ha funcionado". La vibración debe sonar en el momento en que cruza el umbral, para que sepa que ya puede soltar.

Además, una vez cruzado, `crossedReplyRef` nunca vuelve a `false` si el dedo retrocede por debajo del umbral, así que no se puede cancelar la respuesta volviendo atrás.

**Decisión previa a respetar:** el comentario de `:367` dice *"Solo UI-thread mientras deslizas; el JS (haptic + reply) al soltar. Evita el tirón del 1er swipe."* Alguien ya vio un tirón al llamar a JS durante el gesto. Este plan llama a JS **una sola vez** por cruce (no en cada frame), que es mucho menos que antes de ese arreglo, pero el riesgo existe: el feel check de abajo lo comprueba explícitamente y, si el tirón vuelve, el plan se descarta.

## Target

- Al cruzar el umbral hacia fuera: `hapticSelection()` (de `lib/haptics.ts`, ya importado en `:21`) una sola vez.
- Si el dedo vuelve por debajo del umbral: se desarma (sin vibrar) y al soltar no se responde.
- Al soltar armado: se responde **sin** volver a vibrar.

```ts
const fireReply = useCallback(() => {
    onReplyRef.current(itemIdRef.current);
}, []);

const pan = useMemo(
    () =>
        Gesture.Pan()
            .activeOffsetX(16)
            .failOffsetY([-16, 16])
            .onBegin(() => {
                crossedReplyRef.value = false;
            })
            .onUpdate((e) => {
                const x = Math.max(0, Math.min(e.translationX, MAX_DRAG));
                translateX.value = x;
                const armed = x >= REPLY_THRESHOLD;
                if (armed !== crossedReplyRef.value) {
                    crossedReplyRef.value = armed;
                    if (armed) scheduleOnRN(hapticSelection);
                }
            })
            .onFinalize(() => {
                const shouldReply = crossedReplyRef.value;
                crossedReplyRef.value = false;
                translateX.value = withSpring(0, REPLY_SPRING);
                if (shouldReply) {
                    scheduleOnRN(fireReply);
                }
            }),
    [crossedReplyRef, fireReply, translateX],
);
```

`scheduleOnRN` dentro de `onUpdate` solo se llama en el frame en que cambia el estado (una vez por cruce), no en cada frame.

## Repo conventions to follow

- Helpers de vibración en `lib/haptics.ts`; `hapticSelection` ya está importado en este fichero.
- Lógica del gesto en el hilo de UI, como ya hace el comentario de `:367`.

## Steps

1. En `fireReply` (`:362-365`) borra la línea `hapticMedium();`. Si `hapticMedium` deja de usarse en el fichero, quítalo del import de `:21`.
2. Sustituye el `.onUpdate` del gesto por el del **Target**.
3. En `.onFinalize`, asegúrate de que la llamada es `scheduleOnRN(fireReply);` (importa `scheduleOnRN` de `react-native-worklets` si 001 no se ejecutó).

## Boundaries

- NO cambies `REPLY_THRESHOLD`, `MAX_DRAG`, `REPLY_SPRING`, los offsets de activación ni el estilo del icono de responder.
- NO cambies la animación de entrada del mensaje.

## Verification

- **Mechanical**: `npm run typecheck`; `npm run lint`.
- **Feel check** en un iPhone físico con vibración activada:
  - Deslizar un mensaje despacio a la derecha: vibra **una vez**, justo al pasar el umbral, con el dedo aún apoyado.
  - Seguir deslizando hasta el tope: no vuelve a vibrar.
  - Pasar el umbral, volver atrás por debajo y soltar: no se activa responder.
  - Pasar el umbral y soltar: se activa responder sin una segunda vibración.
  - Hacer scroll vertical por el chat: nunca vibra.
  - **Tirón del primer deslizamiento**: en un build de release en el Android más lento disponible, abrir un chat recién arrancada la app y deslizar el primer mensaje. Si el mensaje se engancha o salta al cruzar el umbral, deshaz el cambio, marca el plan como DESCARTADO y anota lo observado.
- **Done when**: la vibración ocurre al cruzar el umbral y retroceder cancela la respuesta.
