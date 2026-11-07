# Activación pública de la agenda: estado y pasos concretos

Los cambios de interfaz, participantes/chat, importación y seguridad están en la rama de revisión. **La agenda no se ha publicado al público y el proveedor sigue desactivado.** No se ha modificado Supabase de producción ni enviado una OTA/versiones a tiendas.

## Ya comprobado

El entorno publicado ya permite acceder al Ayuntamiento y a GitHub; no hace falta volver a publicarlo para estos accesos. Se ha descargado el JSON oficial, observado la licencia CC BY 4.0 y probado una importación de 1.385 actividades en Supabase local dentro de una transacción revertida. Las migraciones de eventos, seguridad y subcategorías están aplicadas en esa base local. Ver [comprobación de la fuente](madrid-source-validation.md).

TypeScript, la suite unitaria y los bundles JavaScript/Hermes de Android/iOS pasan. ESLint no tiene errores y conserva 72 advertencias. Pasaron 92 comprobaciones SQL específicas y el smoke HTTP con cuentas sintéticas. Estos resultados no equivalen a probar la app en dispositivos.

## Pasos pendientes para el público

1. Probar en una app de staging una muestra del catálogo real: rangos de varios días, programas permanentes, días excluidos, horarios, cambios/cancelaciones y lugares ausentes. Comprobar también altas/bajas, bloqueos, chat y denuncias. La importación local valida el formato, no cada calendario.
2. Resolver las dos decisiones de privacidad/mantenimiento descritas en `app-audit-2026-11-06.md`: acceso por enlace UUID a planes privados y mantenimiento global invocado desde el cliente. Son las dos expectativas que siguen fallando en la suite SQL completa. Asignar responsables para denuncias y alertas del importador.
3. Preparar el despliegue revisable de las migraciones y la primera sincronización en el Supabase de producción autorizado. El importador conserva la protección contra escrituras al proyecto de producción del piloto; no debe omitirse para adelantar la activación.
4. Configurar y revisar la ejecución diaria en un entorno protegido. GitHub solo programa cron desde la rama predeterminada; una PR a `develop` no activa cron por sí misma. Elegir el lugar de ejecución sin modificar `main` automáticamente. El workflow preparado sigue condicionado y desactivado.
5. Generar y probar una compilación nativa de staging en Android/iOS. La alineación de `react-native-view-shot` cambia el módulo nativo: revisar el runtime OTA y la compatibilidad de los binarios existentes. Después preparar la versión pública para su revisión y publicación autorizada.

No hacen falta APIs de eventos de pago. Las ejecuciones futuras deben permanecer dentro de las cuotas gratuitas ya disponibles; no se ha contratado ni activado ningún servicio.

## Revisión sin publicar

Las capturas actualizadas están en `docs/screenshots/agenda-editorial.png` y `agenda-compact.png`. El comando `npm run events:preview` muestra una prueba de diseño con los componentes reales y actividades ficticias. La ruta móvil `/agenda-preview` mantiene las tarjetas existentes de planes. Las cuentas, fichas y catálogos ficticios no se presentan como eventos reales.


## Portadas y clasificación ya implementadas

Los eventos reutilizan todas las fotos del catálogo de las seis categorías y 30 subcategorías de Nexo: hiking → AIRE_LIBRE/senderismo, concierto → SHOWTIME/concierto, etc. Cada evento recibe una portada de su clasificación; no se mezclan temáticas para forzar variedad. La migración de subcategorías debe desplegarse antes de la siguiente importación revisada. Ver `event-covers.md`. Las portadas son ilustrativas; no son fotografías verificadas del evento municipal.
