# Nexo 1.0.11

## Español

Descubre actividades de Madrid en Agenda y recomendaciones en Para ti. Consulta la información oficial, súmate al grupo social de una actividad y conversa con otros participantes.

Tarjetas de eventos renovadas, con portadas del catálogo de Nexo y botones más claros. Mejoras en la apertura del perfil, los chats de Android y la sincronización de acciones.

## English

Discover Madrid activities in Agenda and recommendations in For you. View official information, join an activity's social group and chat with other participants.

Refreshed event cards with covers from the Nexo catalog and clearer buttons. Improvements to profile opening, Android chats and action synchronization.

## Distribución

Versión 1.0.11, runtime 1.0.11. Android versionCode 21; iOS build 1.0.21. Las compilaciones iniciadas corresponden al commit `edfb3f0f247fc24f0f59eb3a78685ed72a0030d4`.

El perfil de envío Android apunta explícitamente a `production`, con release `completed`; Google puede mantenerla en revisión antes de hacerla pública. El envío iOS carga el build en App Store Connect/TestFlight: después hay que seleccionar el build, añadir estas novedades a la versión y enviarla a revisión. No se presenta un envío como una aprobación de la tienda.

Resultado observado: ambos builds nativos finalizaron. iOS se envió correctamente; Google rechazó Android con HTTP 403 porque el canal de producción no tiene países habilitados. Configurar Países/regiones en Play Console antes de reintentar; no hace falta iniciar otro build por ese error de configuración.
