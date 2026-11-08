# Agenda de Madrid: estado público · 7 de noviembre de 2026

> Actualización del 8 de noviembre: el feed único y la selección de eventos confirmados están preparados en otra rama y aún no se han desplegado. Ver [estado del nuevo borrador](unified-social-feed.md). Este informe describe la versión anterior.

**Backend de producción activado y comprobado. Distribución móvil iniciada; disponibilidad pública aún no verificada.** La autorización para desplegar Supabase y publicar la funcionalidad se recibió el 7 de noviembre. No se ha modificado `main` ni hecho merge de la PR #44.

## Completado en producción

- Aplicadas y registradas las cuatro migraciones de eventos, límites de API, subcategorías y programación/mantenimiento. El texto del historial coincide con los archivos de origen. Las migraciones históricas aplicadas manualmente con otras fechas se conservaron.
- Fuente municipal y licencia CC BY 4.0 revisadas. Importadas 1.385 actividades futuras/en curso de 1.443 registros; no equivalen a 1.385 sesiones reservables individuales.
- Proveedor Madrid habilitado y lectura anónima comprobada: página de 30, filtro Deportes y ficha. Acceso directo a participantes denegado a invitados.
- Función `sync-madrid-events` activa con `verify_jwt=true` y secreto interno independiente. Rechaza peticiones sin JWT o sin el secreto del programador.
- `pg_cron` configurado a las 05:20 UTC. Probado el recorrido real cron → Edge → importación: HTTP 200, 1.385 importados. No depende de cambiar `main` ni de un workflow de GitHub.
- Archivado global de planes cada cinco minutos en el servidor. Retirado el permiso del cliente.

Evidencia: [informe de despliegue](data/madrid-production-deployment-2026-11-07.json) y [procedimiento reproducible](madrid-production-deployment.md).

## Pendiente para que las tarjetas lleguen a los usuarios

La versión preparada es 1.0.11 y requiere un binario nuevo por la dependencia nativa `react-native-view-shot`. Se ha separado su runtime para no enviar una OTA incompatible a los binarios actuales.

El bloqueo de subida a `storage.googleapis.com` está resuelto y comprobado en el nuevo entorno publicado. Se iniciaron los dos builds de producción sobre `edfb3f0`, con las credenciales existentes y sin repetir migraciones ni importaciones.

Builds y envíos:

- Android 1.0.11/versionCode 21 compilado: [build](https://expo.dev/accounts/ikerlazsor/projects/nexo/builds/2b3b2ddf-8fd8-4ddb-85ca-b6b1c618e0b7), [envío a Google Play producción](https://expo.dev/accounts/ikerlazsor/projects/nexo/submissions/c687a00a-460b-4e7d-836d-d312f143d9ed). El build terminó correctamente. Google rechazó el envío con HTTP 403: «Release in track targeting no countries». Antes de reintentar, entrar en NEXO → Producción → Países/regiones en Play Console y habilitar España o los mercados donde se quiera distribuir. Se conserva el destino `production`/`completed`; no se cambia a pruebas internas para evitar ese requisito.
- iOS 1.0.11/build 1.0.21: [build](https://expo.dev/accounts/ikerlazsor/projects/nexo/builds/fa35602d-1362-4c6d-ab83-58614c5ed584) y [envío a App Store Connect](https://expo.dev/accounts/ikerlazsor/projects/nexo/submissions/88660cc7-c6b9-41d9-8222-e173352679e6) completados. No equivale a aprobación ni distribución pública.

Para iOS queda crear/abrir la versión 1.0.11 en [App Store Connect](https://appstoreconnect.apple.com/apps/6804630497/distribution), seleccionar el build 1.0.21 cuando termine su procesamiento, añadir las [novedades preparadas](release-notes-1.0.11.md) y enviar a revisión. La configuración automática de grupos TestFlight se omitió por un 403 de acceso a Apple desde este entorno; el envío remoto mediante EAS sí finalizó.

El estado observado de cada job se conserva en el [informe de despliegue](data/madrid-production-deployment-2026-11-07.json). No se deben relanzar los builds ni duplicar sus envíos al reanudar una tarea.

Las pruebas manuales en dispositivos se omiten por instrucción del usuario. Pasan TypeScript, suite unitaria, 166 comprobaciones SQL locales, lint sin errores (72 advertencias previas), Chromium y exportaciones Hermes Android/iOS. Además, los builds nativos EAS de Android e iOS han finalizado correctamente; esto no equivale a pruebas en dispositivos.

## Diseño y calidad

Botón «Me apunto» sin «+», estilos compartidos con las tarjetas de planes y todas las fotos de las seis categorías y 30 subcategorías disponibles, según la temática de cada evento. Portadas ilustrativas, fuente/licencia visibles en la ficha, fecha bajo el título y sin frase introductoria ni estrellas en Para ti. Los días excluidos se conservan en el horario; los rangos remiten al calendario oficial.

Se conserva el contrato existente de enlaces UUID para leer meetups privados/solo amigos, que permanecen ocultos del feed; chats y cancelados siguen inaccesibles. Las pruebas se ajustan explícitamente a ese contrato, añadiendo los casos negativos. La suite SQL completa pasa.
