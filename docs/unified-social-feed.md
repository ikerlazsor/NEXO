# Feed social único y eventos confirmados — 8 de noviembre de 2026

Cambios preparados en `feature/unified-social-feed`, sobre la base de #44. No se han aplicado a Supabase de producción ni publicado por OTA o en tiendas. Los registros de publicación de 1.0.11 describen la versión anterior.

## Comportamiento

- Una sola lista, sin Para ti / Planes / Agenda ni cabeceras de secciones. Mantiene los filtros de búsqueda, categoría, subcategoría, fecha y distancia.
- Planes y eventos usan la misma escala de afinidad (`scoreFeedPlanRanked`): gustos del perfil, historial, proximidad y contexto social. Los planes de Nexo reciben 24 puntos adicionales; una afinidad claramente superior puede colocar antes un evento externo. La paginación y las actualizaciones de integrantes conservan el orden que ya se estaba leyendo.
- Solo se publican actividades sociales futuras, con inicio confirmado, dentro de tres meses naturales, recinto concreto y coordenadas verificadas. Un rango de días sin sesiones concretas, una hora ambigua por cambio horario, una fecha TBA o un lugar genérico se retienen fuera del feed. No se generan sesiones diarias a partir de rangos ni reglas de recurrencia.
- La tarjeta muestra fecha y hora bajo el título, portada del catálogo completo de Nexo, «Ya vamos X», avatares públicos y «Me apunto» sin «+». Se elimina el texto municipal visible y se mantiene el acceso a fuente/licencia en la ficha.
- La ficha incluye integrantes, chat social de Nexo y mapa del recinto. Apuntarse no reserva entrada ni plaza oficial; esa información permanece en la ficha.
- El mapa inferior mezcla planes de usuarios y eventos. Carga hasta 90 candidatos externos y conserva representación de ambos dentro del límite de 80 marcadores para evitar saturar el mapa.
- El feed conserva el desplazamiento al volver de cualquier detalle. El perfil muestra la caché actual al abrir y difiere la hidratación/prefetch hasta terminar la transición nativa. Las pulsaciones usan una escala más discreta, respetan reducir movimiento y evitan vibraciones duplicadas.

## Causa del error de inscripción

React Native 0.81 instala `abort-controller`, cuyo `AbortSignal` no implementa `timeout()`. Las mutaciones de eventos invocaban ese método antes de contactar con Supabase. Todas las peticiones de eventos usan ahora un `AbortController` con temporizador y limpieza en `finally`, probado con el mismo polyfill que usa React Native. Las inscripciones son idempotentes; el límite se aplica a eventos futuros, sin penalizar grupos históricos. Las lecturas anteriores a una inscripción y los cambios de cuenta no pueden sobrescribir ni filtrar estado privado.

## Fuentes y ubicaciones

1. **Datos abiertos de Madrid:** conector existente, ahora con selección estricta. La descarga oficial del 8 de noviembre contenía 1.385 registros. Pasaron 360 registros de origen; la prueba SQL local produjo **357 eventos únicos**, sin horarios o coordenadas incompletos, y terminó con `ROLLBACK`. Ver [evidencia](data/confirmed-social-review-2026-11-08.json).
2. **Ticketmaster Discovery API:** conector gratuito preparado, con paginación completa y exclusión de fechas/horas por confirmar. Importa hechos, clasificación y enlace oficial, sin copiar fotos ni textos promocionales. Requiere una clave propia; el proveedor y su tarea diaria permanecen desactivados hasta validar una respuesta real y las condiciones actuales. No se ha consultado esta API ni se afirma que sus eventos estén publicados.
3. **Calendarios iCalendar de organizadores:** soporte para feeds concretos con permiso de reutilización revisado. No hay calendarios adicionales activados ni scraping de Meetup. Los calendarios con recurrencias sin ocurrencias explícitas y los horarios sin zona se retienen.

La resolución de recintos se realiza en el servidor. Nominatim solo se acepta si devuelve una coincidencia única en Madrid, corroborada por nombre o dirección. Los bares homónimos ambiguos se excluyen. Hay caché positiva de 90 días, negativa de seis horas, un trabajo global de importación a la vez y separación entre consultas. El cliente recibe coordenadas: abrir una tarjeta nunca dispara búsquedas de ubicación. El acceso real a Nominatim sigue pendiente de aplicar la configuración del entorno.

Los identificadores de origen se guardan como alias de un evento canónico. La coincidencia conservadora combina título normalizado, inicio dentro de cinco minutos y distancia menor de 150 metros. Los alias mantienen integrantes y chat al añadir fuentes o cambiar el proveedor principal. Una cancelación o un aplazamiento explícitos de una fuente revisada prevalecen sobre el listado activo anterior de otra fuente; su reinstauración conserva el mismo grupo. Los casos ambiguos requieren revisión del origen; no se fusionan eventos distintos por similitud vaga.

## Activación posterior

No ejecutar un despliegue antiguo desde otra rama: el importador necesita la migración `20261108120000_confirmed_social_feed.sql` y viceversa. El script `events:production` de esta rama ya incorpora esa migración y cura la primera carga. El orden es backend y primera carga revisada, comprobación de la tarea diaria y después distribución del cliente. La pasarela Edge conserva `verify_jwt=true` y el secreto interno independiente.

Para Ticketmaster:

1. Crear una aplicación y obtener la **Consumer Key** en [Ticketmaster Developer](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/).
2. Guardarla como `TICKETMASTER_API_KEY` en los ajustes seguros del entorno, sin pegarla en el chat. Revisar y publicar el borrador de configuración que añade `app.ticketmaster.com` y `nominatim.openstreetmap.org`; publicar ese entorno no publica la aplicación.
3. Ejecutar `node scripts/madrid-events-sync.cjs --provider=ticketmaster --report=/tmp/ticketmaster-review.json` y revisar datos, cobertura y condiciones de uso actuales. El modo predeterminado no escribe.
4. Guardar la misma clave en **Supabase Edge Function Secrets**, validar el proveedor en staging y habilitarlo en `event_providers` después de esa revisión. La migración prepara su tarea de las 05:25 UTC, que no solicita nada mientras el proveedor está desactivado. Madrid conserva la tarea de las 05:20 UTC. No guardar la clave con prefijo `EXPO_PUBLIC_` ni en el bundle móvil.

Un calendario de organizador usa `NEXO_ICAL_PROVIDER_ID`, `NEXO_ICAL_FEED_URL` y `NEXO_ICAL_REVIEWED=true`, además de su fila revisada en `event_providers`; `--provider=ical` solo se admite en el importador de servidor/CLI. Una petición HTTP no puede introducir URLs arbitrarias ni seleccionar un proyecto de destino.

## Validación

- Suite completa de aplicación: 16 archivos de pruebas aprobados; peticiones con el polyfill nativo, concurrencia de altas/resúmenes, paginación, filtrado temporal, DST, resolución ambigua de recintos y restauración del desplazamiento.
- SQL local: 212 comprobaciones aprobadas en nueve archivos; permisos/RLS, alias entre proveedores, cancelaciones contradictorias, historial social, inscripción, baja, resúmenes sin identidades para invitados, bloqueos, caché y exclusión de importaciones concurrentes.
- HTTP local real con dos usuarios sintéticos: detalle público, inscripción, consulta de eventos futuros, recuentos/avatares, privacidad de invitados, chat, reintento idempotente y revocación al salir. Los datos sintéticos se eliminan al terminar.
- TypeScript, ESLint y compatibilidad de Expo. Se actualiza únicamente `expo-asset` de 12.0.13 a 12.0.14, el parche compatible indicado por Expo. ESLint mantiene sus 72 advertencias previas y no añade errores. Auditoría npm: cero críticas; permanecen 13 altas, 16 moderadas y una baja en dependencias transitivas. No se fuerza un cambio de SDK de Expo.
- Exportación de bundles Android/iOS y revisión en Chromium del componente de tarjetas a ancho móvil: sin pestañas, texto municipal, introducción ni «+»; hora, recuento y portadas de las 30 subcategorías; sin desbordamiento horizontal ni errores JavaScript. [Captura de diseño](screenshots/unified-social-feed.png), con datos ficticios rotulados.

No se han realizado compilaciones nativas nuevas, pruebas en dispositivos ni comprobado visualmente mapas, vibración o transiciones en Android/iOS reales. La vista previa web comprueba diseño de tarjetas, no sustituye esas pruebas. Tampoco se ha validado Ticketmaster/Nominatim con tráfico real ni se ha distribuido este cambio al público.
