# Portadas de eventos con el catálogo de Nexo

Los eventos reutilizan las fotos locales que ya utiliza la aplicación para los planes. No se descargan fotografías del organizador. Son portadas ilustrativas de la actividad y la información oficial sigue en el enlace del evento.

El importador y la app comparten `lib/externalEventClassification.cjs`. Primero se clasifica por el título, después por el tipo de actividad de la fuente y finalmente por la descripción. Solo se producen categorías/subcategorías existentes. Si no hay información suficiente se usa `otro`, sin inventar una temática precisa.

Ejemplos:

| Actividad de la fuente | Categoría | Subcategoría/portada |
| --- | --- | --- |
| Hiking, trekking, senderismo | AIRE_LIBRE | senderismo |
| Concierto, jazz, recital | SHOWTIME | concierto |
| Obra de teatro | SHOWTIME | teatro |
| Cine o proyección | SHOWTIME | cine |
| Exposición de arte | DESCUBRIR | museo |
| Club de lectura | DESCUBRIR | estudio |
| Taller de idiomas | DESCUBRIR | idiomas |
| Running | DEPORTES | running |
| Yoga | DEPORTES | otro (no existe una subcategoría yoga) |
| Ajedrez | VIBES | juegos_mesa |

`features/events/covers.ts` consulta `getCoverImages` del catálogo existente y selecciona una foto de forma estable a partir de proveedor + ID original + clasificación. Así se conservan las portadas al recargar y no se guardan identificadores de recursos móviles en Supabase. Expo Image reutiliza su caché y la carga de listas existente.

La clasificación se conserva en `external_events.category` y `subcategory` mediante la migración `20261107120000_event_subcategories.sql`. Su constraint impide combinar subcategorías con una categoría incorrecta. Los importadores antiguos sin ese campo usan `otro`; una nueva sincronización completa actualiza los eventos existentes. La app admite registros de servidores anteriores y deduce la subcategoría cuando es compatible con la categoría guardada.

El catálogo completo incluye seis categorías y 30 subcategorías. La prueba de portadas recorre todas las parejas y comprueba que todas sus fotos son seleccionables. La vista previa web permite mostrarlas con «Ver todas las subcategorías (30)»; esas tarjetas son ejemplos sintéticos, no eventos municipales.

Validación: cinco pruebas de clasificación/portadas reales locales; TypeScript sin errores; ESLint sin errores y con sus 72 advertencias anteriores; toda la suite unitaria pasa. Cinco pruebas nuevas SQL, junto con las 87 existentes de eventos/API, pasan (92). Bundles Android/iOS exportados y comprobación visual de ambas tarjetas y las 30 subcategorías a ancho móvil. La [carga del catálogo municipal real](madrid-source-validation.md) se comprobó en una transacción local revertida. No se han aplicado migraciones a producción.
