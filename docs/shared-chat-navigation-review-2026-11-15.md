# Navegación y chat compartido · 15 de noviembre de 2026

**Actualización de publicación:** el usuario autorizó la entrega, renovó el token y la migración y los cuatro bundles OTA ya están publicados y verificados. Consultar el [estado definitivo](shared-chat-navigation-publication-status.md). El informe siguiente conserva la revisión previa a la publicación.

Implementado en `fix/shared-chat-smooth-navigation`, sobre el proyecto actual y conservando los cambios de navegación que ya había en el borrador. **No se ha publicado una OTA, aplicado SQL a producción ni modificado `main`.**

## Arquitectura revisada

El chat de planes (`app/chat/[id].tsx`) concentraba mensajes, adjuntos, grabación, reproducción, respuestas, reacciones, permisos y administración de planes. El chat de eventos era otra pantalla con burbujas, lista y compositor independientes y solo texto. Convertir un evento en un plan ficticio habría introducido un creador artificial y mezclado sus permisos. Se mantienen los datos y permisos correspondientes a cada origen y se comparte la interfaz y la lógica común.

La navegación utiliza Expo Router y native-stack. El acceso al mapa conservaba una hoja animada sobre el pager con temporizadores para cámara y navegación; los detalles y el perfil podían refrescar contenido durante una transición. Se revisaron las rutas, la caché de detalle/perfil, el foco, el teclado y la vuelta desde el chat.

## Cambios

- `ChatHeader`, `ChatTimeline` y `ChatComposer` son los componentes utilizados tanto por planes como por eventos. Conservan los estilos de `createChatStyles`, la lista invertida, las burbujas de `ChatMessageRow`, las respuestas y el compositor original. El teclado y el mantenimiento de la posición al leer utilizan los mismos hooks.
- `useChatMedia` concentra selección de fotos/vídeos, álbumes de momentos, grabación, reproducción y duración del audio. Se usa en ambos chats. Una carga de archivos antigua no puede enviarse en otra cuenta/conversación; los reintentos conservan el archivo ya preparado.
- El adaptador de eventos transforma sus filas al mismo modelo `Message`. Se reutilizan el selector de reacciones, los visores de imagen/vídeo y el álbum de momentos. Se mantienen las denuncias; se permite al emisor borrar su propio mensaje.
- El chat de eventos tiene entrega por Realtime con recuperación por sondeo, historial paginado, integrantes, marca de lectura y preferencias de ocultación/silenciado. Una notificación que llega durante una lectura programa otra lectura y no espera al siguiente sondeo. No se ha incorporado un servicio nuevo de notificaciones push; los envíos push existentes de planes se conservan.
- Los eventos a los que pertenece la persona aparecen en la lista habitual de chats con `ChatListRow` y su portada de categoría. Se abren por su ruta de evento, sin consultar tablas de planes con un UUID de evento. Ocultar un chat no abandona la actividad. Desde el detalle se marca el origen para volver a él sin apilar otra copia.
- iOS usa las transiciones del sistema para plan, evento y chat. El perfil mantiene una entrada vertical de 300 ms y el editor permanece en el mismo stack. Se evita congelar/descongelar el stack de iOS durante la transición de vuelta. Los datos de caché siguen visibles inmediatamente.
- Las consultas de detalle, perfil y editor se coordinan con `transitionEnd`; `InteractionManager` no se utiliza como garantía de que la animación nativa ha terminado. El trabajo se invalida al salir.
- El mapa utiliza una presentación nativa animada. La cámara espera a `onMapReady`; se invalidan las operaciones al cerrar y los callbacks de instancias antiguas se descartan. En iOS, abrir un detalle desde el mapa espera a `onDismiss`. Se conservan agrupación, colores y máximo de marcadores. Las identidades de anotaciones no dependen de las celdas del zoom.

## Base de datos

Se prepara `supabase/migrations/20261115120000_unified_event_chat.sql`. Añade tipos de mensaje y adjuntos privados al chat de eventos, reacciones, borrado del contenido, preferencias, bandeja de chats y publicación de cambios para Realtime. Las funciones anteriores siguen disponibles para clientes existentes.

Los archivos de eventos usan `event_<uuid>_…` en el bucket privado de archivos de chat. Se comprueba la pertenencia al evento; los mensajes no pueden adjuntar archivos de otro evento ni URLs arbitrarias. Las mutaciones comparten el bloqueo por usuario con la operación de abandonar el evento. Los invitados carecen de permisos para la bandeja y las mutaciones; los datos de otra cuenta nunca se escriben en una caché pública.

**La migración solo se ha aplicado y probado en Supabase local. Debe aplicarse en el despliegue autorizado antes de publicar el cliente que usa los RPC nuevos.** La lista de migraciones del script de despliegue incluye esta versión y sus pruebas se han actualizado. No se ha ejecutado ese despliegue.

## Comprobaciones

- `npm test`: **19 archivos aprobados**, incluidos reintentos, separación de cuentas, revocación de acceso, captura/restauración del feed, subida de archivos, descarte de resultados tardíos, cámara nativa y espera de transiciones.
- `npm run typecheck`: aprobado.
- `npm run lint`: **0 errores, 71 advertencias**. No se desactivan reglas para superar la comprobación.
- PostgreSQL local: **280 comprobaciones aprobadas en 13 archivos**; 38 verifican específicamente el nuevo chat. Se comprueban envío, compatibilidad con clientes anteriores, duplicación de reintentos, adjuntos privados, aislamiento entre eventos, reacciones, borrado propio, lectura, ocultación y revocación al abandonar.
- Chromium: vista de prueba aislada que utiliza los componentes reales de ambos chats. Envío, vaciado del compositor y aparición de burbujas comprobados; sin errores JavaScript ni desbordamiento a 360 px. Los datos y el envío de esta vista son ficticios; no equivalen a una sesión autenticada de la app móvil.
- Exportaciones Hermes de Android e iOS completas, con el código final, en `/tmp/nexo-unified-bundle-final`. Son bundles, no compilaciones nativas instaladas.

Capturas de la vista de prueba: [plan](review-assets/shared-chat-plan-2026-11-15.png) y [evento](review-assets/shared-chat-event-2026-11-15.png). Para abrirla localmente: `EXPO_OFFLINE=1 npx expo start preview/chat --web --port 8085`, con las variables públicas de Supabase apuntando al entorno local.

No se ha reproducido el cierre del mapa en un iPhone real ni se ha medido su fluidez nativa. Las pruebas de código, SQL y navegador no permiten dar por comprobado ese comportamiento en dispositivo. La integración de Meetup sigue pendiente según la decisión anterior del usuario.
