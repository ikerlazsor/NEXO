# Agenda social de Madrid · implementación para revisión

> Estado actualizado: las correcciones de #43 ya se reutilizan en esta rama. Para los resultados actuales de seguridad/calidad, consultar [la auditoría aplicada](app-audit-2026-11-06.md) y [los pasos de activación pública](madrid-events-launch.md). La validación original que sigue abajo es histórica.

Rama: `feature/madrid-social-agenda`, basada en `develop` (`4cf1dec`). No se han mezclado las correcciones de la PR #43, modificado `main`, aplicado SQL remoto, publicado OTA ni versiones en tiendas.

## Funcionalidad

El feed tiene **Para ti**, **Planes** y **Agenda**. Planes mantiene `PlanCard` y el ranking social existentes; Agenda muestra exclusivamente eventos externos; Para ti intercala ambos. Se elimina solamente el botón de mapa de la cabecera. El acceso inferior sigue intacto.

`EventCard` ofrece dos variantes: horizontal compacta y editorial con cabecera gráfica, fecha superpuesta y acciones. Las ilustraciones son composiciones originales por categoría (degradados, formas e iconos de la aplicación). No se importan fotografías municipales ni se presupone que la licencia del dataset cubra imágenes. La ficha conserva fuente, enlace oficial, fecha/rango, horario si existe, ubicación, precio si existe y última sincronización. La información ausente se muestra como pendiente de consultar, sin inventarla.

La interfaz nueva incluye español e inglés, con el fallback inglés ya existente para los otros idiomas de Nexo. Las traducciones completas de francés/alemán/portugués/italiano quedan pendientes.

## Reutilización de la PR #41

Se ha revisado su código por Git. Se conserva el fetcher con límite de 8 MiB y timeout, se amplía su normalizador y se reutiliza su corrección de paginación `(fecha_evento, id)` en `lib/feedQuery.ts`. Los scripts originales de preview continúan siendo de lectura; el script de sincronización es el único punto de escritura del importador. El modelo nuevo nunca inserta filas en `planes`.

El prototipo aún no verificaba un fichero municipal real. Sus afirmaciones sobre CC BY 4.0 **no equivalen a una comprobación de la licencia vigente**.

## Algoritmo

`lib/feedAffinity.ts` no se sustituye ni cambia. Se reutilizan sus categorías de personalidad y el `FeedTaste` construido a partir de las preferencias e historial de participación.

Para cada evento externo:

| Señal | Peso | Cálculo |
| --- | ---: | --- |
| Afinidad de categoría | 35 % | Personalidad declarada (60 % de esta señal) e historial de planes (40 %), normalizados |
| Proximidad | 25 % | Distancia Haversine; decae con los kilómetros. Sin coordenadas, valor neutral 0,5 |
| Fecha | 20 % | Decae con los días hasta el inicio; conserva actividades en curso |
| Interacciones | 15 % | Categorías de eventos vistos, enlaces oficiales abiertos y altas sociales, ponderados 1/2/3 |
| Descubrimiento | 5 % | Bonifica eventos todavía no vistos |

Una penalización de 0,10 por categoría repetida entre las tres recomendaciones anteriores favorece diversidad, con desempate estable por fecha e ID. El ranking se limita a un conjunto de 90 candidatos cargados; **no es una búsqueda personalizada sobre todo el catálogo**. Agenda sigue orden cronológico y tiene su propia paginación.

Los scores externos no se comparan directamente con la escala distinta del ranking social. Se conserva el orden de los planes. Con seis o más planes se inserta como máximo un evento por cada tres planes (hasta un 25 % de tarjetas externas); con menos planes se permite más agenda para evitar un feed vacío. No se insertan eventos dentro de «Tus planes».

Las interacciones pertenecen exclusivamente a su usuario. Se consultan hasta 300 interacciones recientes y no se transfieren al navegador de vista previa.

## Importación y actualización diaria

Fuente solicitada: https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100

**Bloqueo comprobado:** el proxy de esta sesión rechaza `datos.madrid.es` con HTTP 403. No se ha descargado el JSON vigente ni leído la licencia actual. Se soportan los formatos del prototipo (`@graph`, lista, `records`, `data`) y los nombres habituales de sus campos; esto está probado con fixtures sintéticas, no constituye validación del contrato municipal actual.

El proveedor se crea **deshabilitado**, con `license_verified_at` y `format_verified_at` vacíos. El servidor rechaza la importación hasta que ambos se revisen y el proveedor se habilite deliberadamente en local/staging. No se ha hecho esto en producción.

- Identidad estable y única `(provider_id, source_id)`. Actualizar fechas o ubicación conserva el ID, participantes y chat.
- Validación de fecha real, zona Europe/Madrid para timestamps con offset, rangos de varios días, coordenadas y enlaces HTTPS. Las fechas locales sin offset no se convierten a horas UTC inventadas. No se materializan sesiones individuales de recurrencias no verificadas.
- Clasificación explícita y conservadora a las seis categorías Nexo. Los cancelados explícitos se actualizan como tales. Un registro ausente no se presenta como cancelación: tras dos snapshots completos pasa a `stale`.
- Un snapshot vacío, con registros futuros inválidos, IDs contradictorios, más de 20.000 candidatos o una caída mayor del 50 % desde un volumen superior a 20 registros se rechaza. No modifica los contadores de desaparición.
- La RPC de sincronización usa una transacción y un bloqueo por proveedor. Los eventos con fecha final pasada se marcan `expired` y no aparecen en el feed.
- Se rechazan redirecciones de la descarga y respuestas mayores del límite. Ningún cliente móvil descarga el catálogo municipal completo.
- `event_providers.last_success_at` sirve de control operativo; si la tarea falla, no avanza. El workflow informa fallo y se debe revisar antes de reactivar.

Comandos de lectura (sin Supabase):

```sh
npm run events:dry-run
# O con una descarga oficial revisada:
npm run events:dry-run -- --file=/ruta/agenda.json
```

Para probar la escritura **solo en local/staging**, se requieren `MADRID_EVENTS_IMPORT_ENABLED=true`, `NEXO_EVENTS_SUPABASE_URL`, una clave de servicio en `NEXO_EVENTS_SERVICE_ROLE_KEY`, y proveedor revisado en esa base. Entonces `node scripts/madrid-events-sync.cjs --apply` aplica un snapshot. La clave no se incorpora al bundle ni se imprime. Este piloto rechaza expresamente el hostname de producción actual.

`.github/workflows/madrid-events.yml` prepara la ejecución diaria a las **05:20 UTC**, con bloqueo de concurrencia, timeout y entorno `madrid-events-staging`. Está condicionado a la variable `MADRID_EVENTS_IMPORT_ENABLED=true`; no está activado ni desplegado. GitHub solo ejecuta cron desde la rama predeterminada: si es `main`, esta PR a `develop` no activa por sí sola el cron. No se ha cambiado la rama predeterminada ni `main`. Debe aprobarse dónde programarlo antes de usarlo de forma continua. El checkout utiliza `develop` salvo configuración explícita `MADRID_EVENTS_REF`.

No se ha contratado ningún proveedor ni introducido un servicio de pago. Un workflow desactivado no consume ejecuciones. Si posteriormente se habilita, debe permanecer dentro de la cuota gratuita de Actions del repositorio y de los límites de Supabase.

## Participantes, chat y privacidad

«Me apunto» presenta la advertencia: **te unes al grupo social de Nexo; no reservas entradas ni obtienes una plaza oficial**. No hay capacidad, aprobación, valoración o supuesto organizador de Nexo inventado para el evento externo.

Un usuario identificado puede unirse y abandonar, ver participantes visibles y acceder al chat desde la ficha. Los invitados pueden consultar eventos, pero deben registrarse para acceder a la parte social; el flujo de login devuelve a la ficha del evento. Se reutilizan autenticación, perfiles públicos, avatar, tema, avisos y enlaces a perfiles existentes. Los mensajes externos tienen tablas y rutas propias para no interferir con políticas de `mensajes`/`planes`.

El chat de esta versión es **de texto**. Solo miembros no baneados pueden leer/enviar; los bloqueos en ambas direcciones ocultan participantes y mensajes. La baja revoca acceso. Se permite denunciar un mensaje con pulsación larga; las denuncias son de inserción para el cliente y lectura de servicio, y requieren una cola de revisión por parte del equipo antes del lanzamiento público. No se han añadido notificaciones push, medios, reacciones ni inclusión de estos grupos en el listado global de chats: se entra desde la ficha del evento.

Los envíos llevan un UUID de cliente para deduplicar reintentos, límite de 2.000 caracteres y 20 mensajes/minuto. Altas y envíos se serializan por usuario. No se encolan altas sociales offline que pudieran confirmar un evento ya cancelado. El chat se refresca cada 10 s únicamente en primer plano y mientras su pantalla está enfocada; se pausa al consultar mensajes antiguos y se recarga al volver a entrar. No usa un canal realtime permanente por cada tarjeta.

## Migración y seguridad

`supabase/migrations/20261106170000_external_social_events.sql` añade:

- `event_providers`: catálogo y revisión del proveedor.
- `external_events`: información externa y estado de sincronización.
- `external_event_participants`: altas sociales, sin datos privados duplicados.
- `external_event_messages`: chat compartido vinculado al ID de evento.
- `external_event_interactions`: señales privadas por usuario/evento/tipo.
- `external_event_reports`: denuncias para moderación.

Incluye índices para fechas/ID, coordenadas, participantes y mensajes. Todas las tablas llevan RLS y privilegios explícitos. Los invitados leen mediante RPCs públicas acotadas y no reciben SELECT directo sobre tablas; las escrituras sociales pasan por RPCs con `auth.uid()`. Solo `service_role` puede sincronizar. Las funciones definer fijan `search_path`. Las relaciones a perfiles se borran en cascada al eliminar la cuenta.

La política de bloqueos admite los dos esquemas de columnas soportados por el repositorio. La migración no presupone la función `users_are_blocked`, ausente al reconstruir el esquema local.

## Rendimiento y fallos de red

Agenda usa páginas de 30 con cursor `(start_date,id)` y filtros de categoría, búsqueda, rango y proximidad aplicados en servidor antes del límite. No hace una consulta de participantes por tarjeta. Las preferencias y altas se cargan en bloque; participantes y mensajes tienen paginación independiente (30/40).

La caché pública en memoria conserva hasta 12 combinaciones de filtros durante dos minutos; se cancelan consultas obsoletas, se retrasa 200 ms el inicio de búsquedas y se limita cada carga a 12 s. Las consultas de agenda no se ejecutan al elegir Planes. La carga externa no bloquea la carga social. Si falla, muestra reintento y conserva el funcionamiento de planes. No se implementa una copia persistente offline de los chats externos.

## Validación realizada y límites

- Pruebas unitarias: siete de arranque existentes, cinco del normalizador de la PR #41, dos del fetcher y ocho nuevas de ranking/importación/mezcla (22 casos). `npm test` pasa; también se ejecutaron directamente los archivos nuevos para comprobar los casos individuales.
- SQL específico: **48 pruebas pgTAP aprobadas** en Supabase local, con usuarios sintéticos y rollback. Incluyen permisos, bloqueos, alta/baja, privacidad, deduplicación, actualización de fechas/ubicación, fallos atómicos, cancelación/caducidad y empates de paginación.
- HTTP local: `npm run events:local-smoke` pasa con dos cuentas sintéticas creadas y eliminadas por la prueba. Comprueba detalle de invitado, privacidad, login, alta, mensajes, reintentos y revocación al abandonar. Restaura el estado anterior del proveedor. No usa la configuración remota vinculada al proyecto.
- Visual: Chromium con los componentes reales, tarjetas editoriales/compactas, navegación de pestañas y ancho móvil. Sin errores JavaScript ni desbordamiento horizontal en las comprobaciones de 430 y 360 px; capturas adjuntas. La vista previa es de diseño, no valida Android nativo.
- Bundles Hermes Android/iOS: generados. No equivalen a APK/IPA ni pruebas en dispositivo.
- ESLint de los archivos nuevos: sin errores ni advertencias. El lint completo mantiene **2 errores y 73 advertencias** en código previo.
- TypeScript completo: mantiene **6 errores previos** en fichas de planes/perfiles; no añade errores de la nueva funcionalidad.
- Compatibilidad Expo (tabla local): sigue detectando view-shot 5.1.1 frente a 4.0.3. La exclusión anterior de FlashList se conserva. La consulta online no está validada.
- Auditoría: conserva el aviso crítico de shell-quote fijado en `develop` (la auditoría completa lo propaga también a react-devtools-core y react-native: 3 entradas críticas). Estas dos correcciones y las de calidad corresponden a la **PR #43**, que debe resolverse por separado antes de integrar/lanzar.
- Integración aislada: se aplicó temporalmente el diff de #43 en un worktree separado de esta rama. Allí pasan TypeScript, ESLint (0 errores, 73 advertencias) y las pruebas unitarias. No se ha incorporado ese diff al historial de esta funcionalidad ni se considera validada su compatibilidad nativa por esta comprobación.
- La batería SQL completa antigua no pasa: `get_guest_feed()` ya no tiene la firma esperada, hay permisos históricos más amplios que los tests esperan, y la prueba de ficha privada falla. No se han debilitado esas comprobaciones ni modificado funciones ajenas.
- Entorno local: el CLI necesitó `--ignore-health-check` porque el proxy interfiere en healthchecks de auth/storage; la API HTTP funcional sí se probó. La imagen PostgreSQL 17.6.1.105 mostró un SIGSEGV al invocar funciones sin permiso EXECUTE. Los tests nuevos comprueban esos ACL mediante `has_function_privilege`, y prueban las denegaciones sociales dentro de las funciones autorizadas. Esta ruta de denegación del motor debe revisarse con una imagen soportada antes de desplegar; no se presenta como prueba de resistencia del servidor.
- Pendientes: fuente y licencia reales, importación de un snapshot municipal revisado en staging, revisión operativa de denuncias, cron aprobado, pruebas de integración móvil y rendimiento en Android real (teclado/edge-to-edge, navegación rápida, redes lentas), regresión de compartir/iOS y validación de las correcciones independientes de #43.

## Ver el diseño antes de publicar

En una copia local con dependencias instaladas:

```sh
npm ci
npm run events:preview
```

Abrir `http://localhost:8083` en ese equipo (o el puerto 8083 reenviado del entorno). Es un proyecto web aislado: usa **los mismos componentes de tarjetas/pestañas**, datos sintéticos y un endpoint local ficticio, y no inicia el arranque completo de la app móvil. Para ti muestra tarjetas compactas; Agenda, editoriales; Planes identifica que deben verse en la app. No permite apuntarse ni atribuye los ejemplos a eventos reales.

En el cliente móvil de desarrollo también existe `/agenda-preview`, con aviso de datos ficticios y la `PlanCard` existente. Se puede abrir con el esquema de desarrollo correspondiente, por ejemplo `nexo://agenda-preview`; no requiere publicar OTA. Para probar altas/chats reales se necesita la app apuntando explícitamente a Supabase local/staging, las migraciones aplicadas allí y cuentas sintéticas.

Capturas del componente real:

- [Agenda editorial](screenshots/agenda-editorial.png)
- [Para ti compacto](screenshots/agenda-compact.png)

No se ha aplicado la migración a producción ni se ha habilitado ninguna importación programada.

## Entrega en GitHub

La rama se ha subido. La API de GitHub rechaza `gh pr create` con `Forbidden`; no se ha creado una PR automáticamente. Abrir [comparación hacia develop](https://github.com/ikerlazsor/NEXO/compare/develop...feature/madrid-social-agenda?expand=1) y usar la descripción preparada en `docs/madrid-events-pr.md`. No hay merge ni despliegue.
