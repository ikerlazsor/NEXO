# Activación pública de la agenda: estado y pasos concretos

Los cambios de interfaz, participantes/chat, importación y seguridad están en la rama de revisión. **La agenda no se ha publicado al público y el proveedor sigue desactivado.** No se ha modificado Supabase de producción ni enviado una OTA/versiones a tiendas.

## Lo que falta para activar eventos reales

1. Revisar y guardar el borrador del entorno con acceso a `datos.madrid.es` , `www.madrid.es` y `api.github.com`, y publicar el entorno si la interfaz lo requiere para aplicar la red. Esto es configuración de desarrollo, no publicar Nexo. El borrador ya está guardado; el runtime sigue con la política anterior.
2. Con esa red aplicada, ejecutar `npm run events:dry-run -- --report=/tmp/madrid-review.json`. El informe tendrá SHA-256, URL, bytes, campos ausentes, categorías y muestras. Revisar el JSON vigente y los términos de reutilización en la página del dataset, y las imágenes por separado. Hasta entonces el proveedor no se considera validado.
3. Aplicar en una base local/staging las dos migraciones de eventos y seguridad; usar solo cuentas sintéticas. Revisar el informe municipal y marcar las verificaciones del proveedor únicamente en esa base después de comprobarlas. Probar cambios/cancelaciones, altas/bajas, bloqueos, chat y denuncias con el catálogo real.
4. Verificar los resultados de la auditoría y resolver las dos decisiones pendientes de privacidad/mantenimiento descritas en `app-audit-2026-11-06.md`, además de las pruebas Android/iOS. La operación de denuncias y alertas de fallos de importación debe tener responsables antes del acceso público.
5. Preparar la migración y el trabajo programado de producción como una entrega revisable, con destino y credenciales en un entorno protegido. El script actual conserva la protección contra escrituras al proyecto de producción: no hay un atajo que omita la revisión de fuente/licencia.
6. Revisar la programación diaria. GitHub solo programa cron desde la rama predeterminada; una PR a develop no activa cron por sí misma. Elegir explícitamente el lugar de ejecución aprobado sin modificar main automáticamente. El workflow preparado sigue condicionado y desactivado.
7. Generar y probar una compilación nativa de desarrollo/staging. La alineación de view-shot cambia el módulo nativo: revisar runtime OTA y compatibilidad de los binarios existentes. Solo después preparar la publicación real para revisión final.

No hacen falta APIs de eventos de pago. Las ejecuciones futuras deben permanecer dentro de las cuotas gratuitas ya disponibles; no se ha contratado ni activado ningún servicio.

## Revisión sin publicar

Las capturas actualizadas están en `docs/screenshots/agenda-editorial.png` y `agenda-compact.png`. El comando `npm run events:preview` muestra una prueba de diseño con los componentes reales y actividades ficticias. La ruta móvil `/agenda-preview` mantiene las tarjetas existentes de planes. Las cuentas, fichas y catálogos ficticios no se presentan como eventos reales.
