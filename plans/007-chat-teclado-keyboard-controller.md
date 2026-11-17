# 007 — Chat: mover la barra de escribir con la posición real del teclado

- **Status**: TODO
- **Commit**: bc6f0c7
- **Severity**: MEDIUM
- **Category**: Performance / Purpose & frequency
- **Estimated scope**: 1 dependencia nativa nueva, 2 ficheros (`lib/chatKeyboard.ts`, `app/_layout.tsx`), ~60 líneas. **Necesita una build nativa nueva (EAS build); no se puede publicar con `eas update`.**

> Este es el único plan que **sí** añade una dependencia. Pide confirmación al dueño del repo antes de instalarla.

## Problem

`lib/chatKeyboard.ts:48-131` sube la lista y la barra de escribir de los tres chats (`app/chat/[id].tsx:1727`, `app/direct-chat/[id].tsx:1181`, `app/event-chat/[id].tsx:153`) escuchando eventos del teclado en el hilo de JS y lanzando una animación por su cuenta:

```ts
// :16
const IOS_KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.99);

// :73-79
const animateTo = (next: number, durationMs: number) => {
    pad.value = withTiming(next, {
        duration: Math.max(160, durationMs || (Platform.OS === 'ios' ? 250 : 220)),
        easing: Platform.OS === 'ios' ? IOS_KEYBOARD_EASING : Easing.out(Easing.cubic),
    });
};

// :82-84
const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';

// :124-128
const animatedStyle = useAnimatedStyle(() => ({
    paddingBottom: pad.value,
}));
```

Abrir y cerrar el teclado en un chat ocurre más de 100 veces al día. Problemas:

1. **Imita la curva del teclado en vez de seguirlo.** El teclado de iOS usa una curva privada del sistema; cualquier bezier se adelanta o se retrasa unos frames. El evento llega al hilo de JS cuando el teclado ya ha empezado a moverse, así que si JS está ocupado (llega un mensaje, se renderiza una imagen) la barra arranca tarde.
2. **En Android usa `keyboardDidShow`**, que llega cuando el teclado ya ha terminado de abrirse. Funciona porque `softwareKeyboardLayoutMode: "resize"` (`app.json:97`) encoge la ventana, pero el salto es seco.
3. `paddingBottom` fuerza recalcular el layout de la lista en cada frame. Se mantiene en este plan (la librería hace lo mismo en su `KeyboardAvoidingView`), pero al menos el valor viene del hilo de UI.

## Target

- Instalar `react-native-keyboard-controller` con `npx expo install react-native-keyboard-controller`.
- `KeyboardProvider` envolviendo la app en `app/_layout.tsx`, al lado de `GestureHandlerRootView`.
- `useChatKeyboardBottomPad` mantiene **la misma firma y el mismo valor devuelto** (un estilo animado con `paddingBottom`), pero el valor sale de `useReanimatedKeyboardAnimation()`, que da la altura real del teclado frame a frame en el hilo de UI:

```ts
import { useMemo } from 'react';
import { Platform } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

function closedPad(safeBottom: number) {
    return Math.max(safeBottom, 10) + 10;
}

/**
 * Sube el composer + lista siguiendo la posición real del teclado (UI thread).
 * Cerrado = safe area. Abierto = altura del teclado + 6px.
 */
export function useChatKeyboardBottomPad(safeBottom: number) {
    const restPad = useMemo(() => closedPad(safeBottom), [safeBottom]);
    const { height } = useReanimatedKeyboardAnimation(); // 0 → -alturaTeclado

    return useAnimatedStyle(() => ({
        paddingBottom: Math.max(restPad, -height.value + 6),
    }));
}

export { Animated as ChatKeyboardAnimated };
```

## Repo conventions to follow

- Instalación siempre con `npx expo install` (resuelve la versión del SDK 54).
- Providers raíz en `app/_layout.tsx` (`ThemedNavigation`, `:578-587`).

## Steps

1. **Pide confirmación** para añadir la dependencia nativa. Si no la hay, PARA.
2. `npx expo install react-native-keyboard-controller`.
3. `app/_layout.tsx`: importa `import { KeyboardProvider } from 'react-native-keyboard-controller';` y envuelve el contenido de `GestureHandlerRootView` en `ThemedNavigation` (`:582-584`):
   ```tsx
   <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.backgroundAlt }]}>
     <KeyboardProvider>{children}</KeyboardProvider>
   </GestureHandlerRootView>
   ```
4. Sustituye **todo** el contenido de `lib/chatKeyboard.ts` por el bloque de **Target**.
5. Haz una build de desarrollo nativa (`npx expo run:android` / `npx expo run:ios`, o EAS development build).
6. **Comprobación en Android** (decide la rama final):
   - Abre un chat y el teclado. Si la barra de escribir queda **separada del teclado por un hueco de la altura del teclado**, la ventana sigue encogiéndose y el padding se está sumando dos veces. En ese caso cambia el estilo a:
     ```ts
     paddingBottom: Platform.OS === 'android'
         ? (height.value < 0 ? 6 : restPad)
         : Math.max(restPad, -height.value + 6),
     ```
   - Si la barra queda justo encima del teclado, deja el **Target** tal cual.
   Anota en el informe qué rama has dejado y por qué. Si te quedas con el **Target** tal cual, quita `Platform` del import para que el lint no se queje.

## Boundaries

- NO cambies las tres pantallas de chat: siguen usando `ChatKeyboardAnimated.View` y el estilo devuelto.
- NO cambies `softwareKeyboardLayoutMode` ni `edgeToEdgeEnabled` en `app.json`.
- NO uses `KeyboardAvoidingView` ni `KeyboardStickyView` de la librería en este plan.
- NO publiques con `eas update`: el cambio necesita binario nuevo. Avisa de ello en el informe.

## Verification

- **Mechanical**: `npm run typecheck`; `npx expo install --check` sin avisos; la app arranca en build nativa sin el error "KeyboardProvider not found".
- **Feel check** (build de release en el Android más lento disponible y en un iPhone):
  - Abrir el teclado en un chat: la barra de escribir sube **pegada** al borde del teclado en todo el recorrido, sin adelantarse ni quedarse atrás. Grabar a cámara lenta: no debe verse fondo entre barra y teclado en ningún frame.
  - Cerrar el teclado arrastrando la lista (iOS, cierre interactivo): la barra baja con el dedo.
  - Cambiar entre teclado de letras y emojis (cambia la altura): la barra sigue sin saltos.
  - Con el teclado cerrado, la barra queda sobre la zona segura (no debajo de la barra de inicio del iPhone).
  - Llegar un mensaje justo mientras se abre el teclado: la barra no se retrasa.
- **Done when**: el padding sale de `useReanimatedKeyboardAnimation`, no queda `Keyboard.addListener` en `lib/chatKeyboard.ts` y la barra sigue al teclado en ambas plataformas.
