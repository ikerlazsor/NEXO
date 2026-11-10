# Carga de actividades y detalle · 10 de noviembre de 2026

Rama `fix/instant-event-feed-detail`, sobre la entrega publicada del 9 de noviembre. Esta revisión responde a la demora del catálogo, las tres únicas actividades, los dos modos del mapa y el detalle brusco y sobrecargado.

## Cambios

- La caché pública de actividades se hidrata junto con la de planes durante el arranque. La consulta pública comienza sin esperar a la sesión, comparte peticiones en curso y conserva cancelación independiente por pantalla. Participación, perfiles, chats e históricos privados siguen utilizando el cliente autenticado.
- Se corrige la carrera que descartaba la caché si el disco respondía antes de arrancar la petición. Una respuesta antigua del disco no sustituye una página nueva de red; si falla la red, la caché sigue disponible.
- El mapa muestra juntos planes y actividades, tengan o no integrantes. Se conservan el agrupamiento por zona/categoría, los colores y el límite de marcadores nativos. Se retiran «Con gente» y «Explorar».
- Nuevo detalle con portada, fecha/hora/lugar agrupados, integrantes Nexo, descripción y acceso a información y reservas. Se eliminan los avisos reiterativos del detalle y del chat. La atribución permanece en un pie discreto.
- Los datos conocidos se muestran al montar la pantalla. Las consultas privadas esperan a la transición nativa de entrada. El mapa se crea cuando su sección entra en pantalla y se conserva durante la animación de salida. No se presentan mediciones de fluidez en dispositivo que no se han realizado.
- Se admiten actividades participativas antes descartadas por su vocabulario: collage, fanzines, lectura, rope flow, paseos ornitológicos, talleres creativos para adultos y mecánica de bicicletas. Las descripciones permiten descartar actividades específicamente infantiles o familiares. Las actividades generales que también admiten menores no se anuncian como exclusivas para adultos.

## Catálogo

Descarga oficial del 10 de noviembre, 08:41 UTC: 1.272 registros; **14 actividades válidas**, frente a las 3 de la política anterior. SHA-256: `9389963061451ef17c5ea6680a93be6fdc24b50069223f30b73d88a81c403066`. El plan de despliegue volvió a descargar la misma fuente a las 09:00 UTC y obtuvo el mismo hash y número de candidatos.

Se mantienen fecha, hora y lugar confirmados, coordenadas válidas, máximo tres meses, deduplicación y exclusión de conciertos/espectáculos. No se generan recurrencias ficticias. La nueva migración solo oculta registros que no cumplen las reglas; el importador revisado actualiza los hechos de origen sin borrar integrantes ni chats.

Las otras fuentes siguen en el estado documentado en [la revisión anterior](social-discovery-review-2026-11-09.md): no se ha activado una importación sin acceso permitido. Ticketmaster continúa desactivado.

## Validación

- 18 archivos de pruebas aprobados, incluidas nuevas regresiones de caché antes/después de la red, recuperación sin conexión, peticiones compartidas, cancelación y catálogo sin bloqueo de autenticación.
- TypeScript aprobado; ESLint sin errores, con las 71 advertencias previas.
- 242 comprobaciones SQL locales aprobadas en 12 archivos.
- API HTTP de Supabase local: usuarios ficticios, privacidad del invitado, apuntarse, avatares públicos, chat compartido, deduplicación de reintentos y revocación al salir.
- Chromium: detalle a 390 y 360 píxeles, sin desbordamientos ni errores JavaScript; portada, CTA, vuelta y mapa diferido hasta entrar en pantalla. Datos de vista previa ficticios.
- Pendiente en este punto: exportaciones finales de los dos runtimes y publicación/verificación. El estado definitivo se registra por separado tras completar la publicación.

No se ha probado en un dispositivo real. Las pruebas web y los bundles no validan por sí solos el rendimiento de las animaciones ni la estabilidad del mapa nativo.
