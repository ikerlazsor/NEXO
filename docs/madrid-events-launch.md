# Agenda de Madrid: estado público · 7 de noviembre de 2026

**Backend de producción activado y comprobado. La nueva app móvil todavía no está distribuida.** La autorización para desplegar Supabase y publicar la funcionalidad se recibió el 7 de noviembre. No se ha modificado `main` ni hecho merge de la PR #44.

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

Se intentó la compilación EAS con las credenciales Android existentes. La subida del archivo del proyecto falló con HTTP 403: el entorno todavía no permite `storage.googleapis.com`, destino confirmado mediante la API oficial de Expo. No se llegó a iniciar una compilación nueva ni a enviar una versión a las tiendas.

El borrador del entorno ya conserva los dominios y secretos existentes y añade ese hostname. Hay que revisar/guardar el cambio de red y publicar el entorno para aplicarlo. Después:

1. Reanudar las compilaciones `production` de Android/iOS con el código de esta rama.
2. Enviar los artefactos concretos a sus tiendas; resolver cualquier credencial de tienda que falte.
3. Completar la revisión y distribución pública de Apple/Google. Una carga a TestFlight no equivale a publicar en App Store.

Las pruebas manuales en dispositivos se omiten por instrucción del usuario. Pasan TypeScript, suite unitaria, 166 comprobaciones SQL locales, lint sin errores (72 advertencias previas), Chromium y exportaciones Hermes Android/iOS. No se presentan estas exportaciones como APK/IPA compilados.

## Diseño y calidad

Botón «Me apunto» sin «+», estilos compartidos con las tarjetas de planes y todas las fotos de las seis categorías y 30 subcategorías disponibles, según la temática de cada evento. Portadas ilustrativas, fuente/licencia visibles en la ficha, fecha bajo el título y sin frase introductoria ni estrellas en Para ti. Los días excluidos se conservan en el horario; los rangos remiten al calendario oficial.

Se conserva el contrato existente de enlaces UUID para leer meetups privados/solo amigos, que permanecen ocultos del feed; chats y cancelados siguen inaccesibles. Las pruebas se ajustan explícitamente a ese contrato, añadiendo los casos negativos. La suite SQL completa pasa.
