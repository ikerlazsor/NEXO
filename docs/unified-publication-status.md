# Feed único publicado — 8 de noviembre de 2026

**Backend y actualizaciones móviles publicados en producción y verificados.** Se mantiene Madrid activo y Ticketmaster desactivado. No se ha modificado `main` ni hecho merge.

## Actualizaciones móviles

Se publicaron los bundles ya preparados, sin recompilar ni repetir migraciones. Las horas siguientes corresponden a Madrid.

| Apps destinatarias | Runtime | Hora de publicación | Grupo de Expo | Plataformas |
| --- | --- | --- | --- | --- |
| Apps públicas 1.0.10 | 1.0.0 | 19:28 | `ccfda7cb-a70a-4118-a7af-266470f9c20e` | Android e iOS |
| Binarios 1.0.11 | 1.0.11 | 19:29 | `721e2cc4-28a2-479f-b2e5-33af8fdb8e83` | Android e iOS |

Los cuatro manifiestos públicos de `u.expo.dev` se consultaron con el canal `production` y cada combinación de plataforma/runtime. Todos devolvieron el UUID de la publicación esperada y el SHA-256 exacto del bundle exportado. La comprobación terminó a las 19:30, hora de Madrid.

La variante 1.0.10 conserva el mismo código de funcionalidad y las versiones JS originales de sus módulos nativos: view-shot 5.1.1 y expo-asset 12.0.13. Se verificaron los binarios existentes Android versionCode 19 e iOS build 1.0.19, SDK 54 y React Native 0.81.5. Su checkout y dependencias son independientes (`release/unified-feed-runtime-1.0.0`, commit `eaf8c1c`). La variante 1.0.11 conserva view-shot 4.0.3 y expo-asset 12.0.14 (`feature/unified-social-feed`, commit de publicación `b0640b3`, código cliente de `fbe22f8`). Expo selecciona la variante por runtime.

## Backend

- Las migraciones `20261108120000_confirmed_social_feed.sql` y `20261108180000_consolidate_legacy_event_groups.sql` ya estaban aplicadas y registradas en `nixeproyzxvqzyrvsxcx`; no se repitieron en esta reanudación.
- Importador Edge actualizado, con JWT de pasarela y secreto interno conservados. Primera sincronización real: HTTP 200, 359 registros aceptados de 1.385 registros de origen. La tarea diaria sigue activa.
- Se consolidaron tres duplicados heredados. Las seis filas afectadas no tenían integrantes ni mensajes en producción. La migración también se probó con integrantes, chat, denuncias e historial sintéticos para verificar que los conserva.
- La comprobación HTTP anterior de las 18:12, hora de Madrid, mostró 353 eventos publicables, cero pares duplicados, horas/coordenadas completas, filtros correctos y resúmenes sin identidades para invitados. El recuento disminuye conforme comienzan las actividades.
- Se volvió a comprobar por lectura durante esta publicación: Madrid habilitado y Ticketmaster deshabilitado. No se ha solicitado ni utilizado una clave de Ticketmaster.

## Bloqueo de red resuelto

La subida anterior fue rechazada con HTTP 403, `Domain forbidden`, para `update-assets-upload-production.storage.googleapis.com`. El propietario guardó y publicó el entorno. Se comprobó la política aplicada en el nuevo entorno y una conexión nueva antes de reintentar. Ambas subidas firmadas terminaron correctamente; el bloqueo queda resuelto.

Los bundles permanecen bajo `/workspace/NEXO/builds/ota/unified-feed-2026-11-08/`, ignorados por Git. No volver a ejecutar los comandos de publicación para esta entrega: ambos grupos ya existen.

## Validación y uso

Suite de aplicación aprobada (16 archivos), 222 comprobaciones SQL en diez archivos, TypeScript de ambas variantes, exportaciones Hermes Android/iOS y verificación de los cuatro manifiestos/hashes en producción. No se han realizado pruebas en dispositivos reales. Esta publicación OTA no crea nuevas versiones en las tiendas ni cambia los envíos nativos anteriores.

Para ver la actualización, cerrar NEXO completamente y volver a abrirla con conexión a Internet. Si en la primera apertura aún aparece la versión anterior mientras se descarga, dejar unos segundos y volver a abrirla. La app dispone además de descarga y recarga automática en un momento seguro.

Evidencia completa, UUID de cada plataforma y hashes: [informe de publicación](data/unified-production-deployment-2026-11-08.json). Comprobación anterior del backend: [verificación pública](data/unified-live-verification-2026-11-08.json).
