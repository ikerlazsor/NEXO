# Chat compartido y navegación publicados · 15 de noviembre de 2026

**Migración y actualización OTA publicadas en producción y verificadas.** El usuario autorizó la publicación y sustituyó el token de Supabase que bloqueaba la entrega.

Esta ronda incorpora los componentes compartidos de chat para planes y eventos, los adjuntos, respuestas y reacciones de eventos, su bandeja de chats y los ajustes de navegación de mapa, planes, eventos y perfil.

| Instalaciones destinatarias | Runtime | Publicación, hora de Madrid | Grupo Expo |
| --- | --- | --- | --- |
| Instalaciones anteriores compatibles | 1.0.0 | 15:34 | `24aa62d3-640d-46b3-bbc4-ed4f5e13a8a1` |
| Versión 1.0.11 | 1.0.11 | 15:32 | `015ec434-ac08-4929-b127-9ec48f75ad45` |

Los dos grupos incluyen Android e iOS. Los cuatro manifiestos públicos del canal `production` devolvieron los UUID esperados y el SHA-256 exacto del bundle correspondiente. Última verificación: 15:34, hora de Madrid. Las dependencias nativas de cada runtime se conservaron y el código cliente se comparó sin diferencias entre las dos variantes.

Supabase recibió únicamente `20261115120000_unified_event_chat.sql`. Quedó registrada en el historial, los nuevos RPC están disponibles para cuentas autenticadas, el bucket sigue siendo privado y la publicación de mensajes por Realtime está activa. Los conteos de eventos, integrantes y mensajes, y la huella del contenido de los mensajes existentes, coinciden antes y después de la migración. No se ejecutó una nueva importación del catálogo ni se desplegó el sincronizador.

La comprobación HTTP confirmó que el feed público responde HTTP 200 y que los RPC de bandeja, reacciones y envío de eventos rechazan invitados con HTTP 401. No se crearon usuarios ni mensajes de prueba en producción.

Código cliente: `e9764d2` para runtime 1.0.11 y `0b4f2f4` para runtime 1.0.0. Artefactos locales: `builds/ota/shared-chat-navigation-2026-11-15/runtime-1.0.0/` y `runtime-1.0.11/`, ignorados por Git.

Validación previa: 19 archivos de pruebas aprobados, 280 comprobaciones SQL locales, TypeScript en las dos variantes, ESLint con 0 errores y 71 advertencias, vista de componentes en Chromium y cuatro bundles Hermes. No se han probado las transiciones ni reproducido el cierre del mapa en un dispositivo real; la publicación no sustituye esa comprobación.

La integración de Meetup sigue pendiente por decisión del usuario. No se modificó `main`, no se hizo merge y no se creó una nueva versión de tienda.

Para recibir la actualización: abrir NEXO con conexión, dejar que se descargue y cerrar y volver a abrir si aún aparece la versión anterior. **No repetir la publicación: los dos grupos ya existen.**

[Revisión funcional](shared-chat-navigation-review-2026-11-15.md) · [Evidencia de backend, IDs y hashes](data/shared-chat-navigation-release-2026-11-15.json)
