# Publicación del chat compartido y navegación · 15 de noviembre de 2026

**Publicación autorizada por el usuario y preparada; bloqueada por un token de Supabase inválido.** No se ha aplicado la migración a producción ni publicado ninguno de los nuevos bundles OTA.

La API de administración de Supabase devolvió HTTP 401 con `Invalid access token` al leer el historial de migraciones y al comprobar el acceso a proyectos. La variable afectada es `SUPABASE_ACCESS_TOKEN`. Se solicitó sustituirla mediante los ajustes seguros del entorno; no se necesitan valores de credenciales en el chat.

La publicación debe continuar con la migración revisada `20261115120000_unified_event_chat.sql` y después la OTA. Publicar el cliente antes de disponer de sus nuevos RPC dejaría incompleto el chat de eventos.

Ya se han preparado con las variables de producción los cuatro bundles Hermes: Android/iOS para runtime 1.0.0 y Android/iOS para runtime 1.0.11. Se conservaron sus dependencias nativas y se comparó el código cliente de ambas variantes sin diferencias. La comprobación actual de builds Expo mantiene estas dos familias de instalaciones; no se está creando una nueva versión de tienda.

- Código actual: `e9764d2`, rama `fix/shared-chat-smooth-navigation`.
- Variante compatible con instalaciones anteriores: `0b4f2f4`, rama `release/shared-chat-navigation-runtime-1.0.0`.
- Artefactos locales: `builds/ota/shared-chat-navigation-2026-11-15/runtime-1.0.0/` y `runtime-1.0.11/`, ignorados por Git.
- Verificación previa: 19 archivos de pruebas, 280 comprobaciones SQL locales, TypeScript, ESLint con 0 errores y 71 advertencias, y vista de componentes en Chromium. No se han realizado pruebas en dispositivo real.

No se han modificado el catálogo de actividades ni las funciones de sincronización en esta preparación. No se ha modificado `main` ni hecho merge. Meetup continúa pendiente por decisión del usuario.

[Revisión funcional](shared-chat-navigation-review-2026-11-15.md) · [Hashes y estado de preparación](data/shared-chat-navigation-release-2026-11-15.json)
