# Revisión de descubrimiento social · 9 de noviembre de 2026

**Actualización posterior:** el usuario autorizó la publicación y las correcciones ya están en producción. Consultar [estado de publicación](social-discovery-publication-status.md). El contenido siguiente conserva el alcance y la validación de la revisión previa.

Trabajo en `fix/social-discovery-stability`, basado en el código publicado de `6ca0dcf`. No se han aplicado migraciones a producción ni publicado una OTA, una versión de tienda o un entorno. Los cambios previos publicados se conservan; esta revisión añade correcciones sobre ellos.

## Cambios preparados

- **Feed:** prioridad por niveles: planes propios o a los que ya vas, planes de amigos y después afinidad; los planes Nexo conservan un impulso dentro de su nivel. La caché pública se precarga y persiste sin guardar perfiles ni membresías en disco. La llegada de actividades, la ubicación y las actualizaciones en segundo plano ya no reinician el orden de lectura. Al refrescar expresamente se recalcula el orden cuando terminan las cargas.
- **Volver del detalle:** se captura la posición nativa al pulsar, se detiene la inercia y se conserva la tarjeta visible con su desplazamiento interior. Los eventos tardíos de scroll no sobrescriben ese punto. La restauración tiene pruebas de regresión para inercia y cambios de altura anteriores a la tarjeta.
- **Mapa:** coordenadas validadas; marcadores nativos, agrupados por zona y categoría, con un máximo de 36 visibles. La vista inicial «Con gente» oculta actividades vacías y «Explorar» permite encontrarlas. Todas siguen disponibles en el carrusel. Tarjetas, detalle y pines usan la misma clasificación y paleta. Se elimina el mapa nativo oculto que consumía recursos en segundo plano.
- **Detalle y perfil:** contenido conocido visible desde el primer render; consultas de participación en paralelo; mapas montados después de la transición. El perfil usa una pantalla del mismo stack para evitar cerrar y reabrir un modal al entrar al editor. No se cambia la actualización inmediata de los datos de perfil.
- **Participación:** no se muestra «Ya vamos 0». El detalle de eventos tiene una barra inferior con «Me apunto»/«Apuntado», confirmación al abandonar y acceso al chat. Los integrantes siguen siendo usuarios Nexo; no se mezclan con asistentes de otras plataformas ni se reserva una entrada externa.
- **Selección social:** el título debe identificar una actividad participativa; fecha, hora y ubicación confirmadas y un máximo de tres meses. Se excluyen conciertos, espectáculos, festivales, carteleras, anuncios genéricos, actividades infantiles y sesiones sin confirmar. La misma política se aplica al importador, al cliente y a la paginación SQL. Las membresías y mensajes existentes se conservan.
- **Portadas:** se usa el catálogo existente según actividad. Yoga utiliza la foto de yoga que ya existía en «Aire libre · Otros»; Pilates conserva una imagen deportiva neutra. Las categorías «Otros» ya no sortean indistintamente fotos de combate, buceo, lectura o meditación. Para actividades sin foto específica se usan imágenes neutras de grupos. Son portadas ilustrativas, no fotografías del evento.

## Investigación de fuentes adicionales

Se consultaron páginas públicas el **9 de noviembre de 2026**. Las fichas y sus coordenadas se contrastaron con JSON-LD y, cuando hacía falta, con los datos públicos de la misma ficha, comprobando URL, título y hora exactos. No se copiaron descripciones, fotografías, perfiles de asistentes ni tokens.

| Fuente | Resultado de la revisión | Estado |
| --- | --- | --- |
| [Meetup / Madrilingo](https://www.meetup.com/meetup-group-uwzuhxpe/events/317255187/) | Intercambio de inglés y español, 15/11/2026, 11:00–13:00, Huete Cervecería, Santa Engracia 134. Coordenadas publicadas y coincidentes. La lista de descubrimiento indicaba lista de espera. | Ficha verificada; no garantiza plaza. Acceso automático/API pendiente. |
| [Eventbrite / HUNDRED](https://www.eventbrite.es/e/entradas-yoga-good-vibes-en-hundred-majadahonda-2004010432149) | Yoga, 14/11/2026, 10:00–11:00, Avenida de la Victoria 144. Coordenadas publicadas. | Ficha verificada; importación automática no autorizada. |
| [Eventbrite / Alba, Pakus](https://www.eventbrite.es/e/vinyasa-hatha-yoga-be-here-be-present-tickets-2004215525589) | Vinyasa–Hatha, 21/11/2026, 11:00–12:00, Verdaguer y García 51. Todos los niveles; coordenadas publicadas. | Ficha verificada; importación automática no autorizada. |
| Eventbrite / idiomas en EL LOCO y Yoga by We/On | Las fichas dicen «varias fechas», pero su sesión estructurada corresponde a junio o al 7 de noviembre. | Excluidas: no se inventa la próxima fecha a partir de la recurrencia. |
| [Citylife Madrid](https://www.citylifemadrid.com/activities/) | Actividades para personas internacionales. El calendario específico de actividades no devuelve sesiones futuras; las páginas de idiomas/baile enlazan también viajes fuera de Madrid. | No se generan sesiones semanales a partir del texto genérico. |
| [ESN UCM](https://www.esnucm.org/eventos), [ESN UAM](https://www.esnuam.org/eventos) | Comunidades útiles para recién llegados; no apareció una relación pública suficiente de sesiones fechadas en las páginas consultadas. | Pendientes de un calendario o feed confirmado. |
| [Lingobongo](https://www.lingobongo.com/madrid/) | Tablón con anuncios de empleo, clases e intercambios individuales. | No se convierte un anuncio en un evento de grupo confirmado. |
| Madrid Babel | La página consultada devolvió HTTP 503. | Sin verificar. |
| Madrid Outdoors | Falló el acceso HTTP desde el entorno. | Sin verificar. |
| Hiking Madrid | El dominio consultado devuelve contenido ajeno al senderismo en Madrid. | Descartado. |

Todas las horas de esta tabla son **Europe/Madrid**. La evidencia mínima, con hashes de las respuestas y coordenadas, está en [social-source-facts-2026-11-09.json](data/social-source-facts-2026-11-09.json). Las tres fichas son ejemplos verificados en esa fecha, no eventos ya importados ni una promesa de disponibilidad.

### Por qué no están activadas esas fuentes

Las [condiciones de Eventbrite, apartado 13](https://www.eventbrite.es/help/es/articles/251210/terminos-de-servicio-de-eventbrite/) dicen: «aceptas no raspar, arrastrar o utilizar ningún medio automático para extraer datos de los Sitios». Las [condiciones de Citylife](https://www.citylifemadrid.com/terms-conditions/) limitan la reutilización comercial del contenido. No consta acceso API aprobado a Meetup; su página de condiciones redirige además a un dominio aún no habilitado en este entorno.

Se ha preparado un lector de hechos estructurados con validación de sesiones, lugares e identidad estable, y un recolector acotado para revisar fuentes. **No se ha activado un scraping periódico ni marcado ninguna fuente como autorizada.** Para activar una nueva fuente hace falta un feed/API permitido o autorización de su editor, revisar una descarga completa y probar su importación antes de habilitarla. Ticketmaster permanece desactivado.

El recolector de revisión (`scripts/events/public-source-review.cjs`) exige `NEXO_PUBLIC_SOURCE_ACCESS_APPROVED=true` antes de acceder automáticamente al editor. Ese indicador documenta una autorización obtenida fuera del script; no la concede. Sus informes siempre indican `complete_import_snapshot: false` y no se deben usar para reconciliar automáticamente un catálogo completo. El lector JSON-LD está disponible en el importador mediante `--provider=jsonld`, con la configuración y revisión explícitas de la fuente.

## Validación

- `npm test`: 18 archivos de pruebas aprobados, incluidos orden por niveles, llegada tardía de actividades, restauración de scroll, clasificación/portadas, geometría del mapa, aislamiento entre cuentas y lectores de fuentes.
- `npm run typecheck`: aprobado.
- `npm run lint`: 0 errores; 71 advertencias existentes o pendientes de limpieza. No se ocultan ni se desactivan reglas para pasar.
- PostgreSQL local: 232 comprobaciones aprobadas en 11 archivos. La nueva migración social se probó antes del corte del entorno; sus logs se conservaron y se han revisado. No se ha ejecutado en producción.
- Exportaciones Hermes de Android e iOS completadas con los cambios finales. Esto verifica los bundles, no una compilación nativa instalada.
- Chromium: tarjetas de ejemplo, fecha bajo el título, botón sin «+», ausencia de «Ya vamos 0», ancho de 360 px sin desbordamiento y sin errores JavaScript. La pantalla de ejemplos usa datos ficticios y no es el feed autenticado.
- No se ha reproducido el cierre del mapa ni medido las transiciones en un móvil real. Se han reducido las causas de carga y renderizado encontradas; esa estabilidad no se presenta como verificada en dispositivo.

## Pendiente

La publicación de las correcciones se autorizó y completó posteriormente, incluida la migración y los bundles compatibles. La importación automática desde nuevas webs sigue pendiente de un acceso permitido y una prueba completa de integración. Al activar una fuente futura habrá que revalidar fechas, aforo externo y cancelaciones. No se modificó `main` ni se hizo merge.
