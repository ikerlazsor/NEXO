# Revisión de calidad y chats Android

Base: `develop` (`4cf1dec`). Rama: `fix/android-chat-quality`.

## Cambios

- Corregidos los dos errores ESLint: el manejador GPS ya no tiene nombre de hook y el efecto de portada del modal de compartir se ejecuta antes del retorno condicional.
- Corregidos los seis errores TypeScript: una única definición de snapshot para caché y detalle, género validado al entrar desde el perfil/feed, valoración pendiente correctamente tipada, perfil público con campos opcionales y retirada de una comprobación redundante de modo de fútbol dentro de una rama que ya la garantizaba.
- Override de `shell-quote` actualizado de 1.10.0 a 1.11.0 para resolver GHSA-pqg4-j6r4-53mv.
- `react-native-view-shot` fijado a 4.0.3, versión recomendada por Expo SDK 54; los usos existentes de `captureRef` pasan TypeScript.

## PR #42

Revisados los commits `749df27` y `94c6ffd` obtenidos mediante la referencia Git de la PR. Se incorporan sus cambios:

- En Android se elimina el texto fantasma con la hora y se muestra una sola hora en una fila propia, también en mensajes eliminados. Se conserva el indicador de envío pendiente. El cambio evita depender de transparencia en spans nativos de texto.
- El teclado Android deja 6 px de separación y delega el redimensionado a `softwareKeyboardLayoutMode: resize` ya configurado en app.json. iOS conserva la compensación de altura y seguimiento de frames.
- Tanto `app/chat/[id].tsx` como `app/direct-chat/[id].tsx` usan `ChatMessageRow` y `useChatKeyboardBottomPad` dentro de un contenedor flexible. La corrección cubre ambas rutas a nivel de código.
- Añadidas dos pruebas del hook con eventos de teclado simulados: apertura repetida, cambio de altura, cierre, safe area y limpieza de listeners Android; overlay y cambios de frame iOS. Estas pruebas no reproducen el layout nativo.

## Validación

- `npm run bundle:check`: exportados correctamente los bundles Hermes de Android e iOS.
- TypeScript: sin errores.
- ESLint: sin errores; permanecen 73 advertencias previas.
- Pruebas: siete existentes y dos nuevas aprobadas.
- Auditoría npm completa: cero vulnerabilidades críticas y ningún aviso de shell-quote. Permanecen avisos altos/moderados/bajos en otras dependencias; no se han forzado migraciones del SDK para eliminarlos. Los totales de auditoría pueden variar entre consultas del registro.
- Compatibilidad: `CI=1 EXPO_OFFLINE=1 npx expo install --check` pasa usando la tabla del SDK instalado. La consulta online de Expo falló por red. Se mantiene la exclusión preexistente de FlashList, que esta comprobación no valida.

## Validación manual pendiente

No hay SDK Android, adb ni dispositivo Android disponible; tampoco Xcode en este entorno Linux. Exportar bundles no equivale a compilar APK/IPA ni a probar la aplicación nativa.

En chat individual y grupal, comprobar en Android:

1. Mensajes propios y ajenos, cortos, multilínea, con enlaces, respuestas, pendientes y eliminados: una sola hora visible y sin solapamientos.
2. Abrir/cerrar el teclado repetidamente, escribir varias líneas y cambiar entre teclado de texto y emoji: barra de escritura visible y sin hueco excesivo.
3. Probar rotación, navegación por gestos/botones y versiones Android con edge-to-edge; comprobar especialmente que el sistema aplica resize.
4. En iOS, comprobar la posición de la hora y la animación del teclado; comprobar también compartir capturas tras alinear view-shot con Expo.

No se ha modificado Supabase ni ejecutado pruebas contra producción. No se han publicado actualizaciones OTA, compilaciones en tiendas ni merges.
