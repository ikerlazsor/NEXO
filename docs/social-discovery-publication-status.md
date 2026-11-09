# Correcciones de descubrimiento publicadas · 9 de noviembre de 2026

**Backend y OTA publicados en producción y verificados.** Esta entrega incorpora el orden estable del feed, la restauración de la tarjeta al volver, los cambios de mapa, participación, portadas y navegación de perfil/detalle. El usuario autorizó expresamente esta publicación después de revisar el trabajo preparado.

| Aplicaciones destinatarias | Runtime | Publicación, hora de Madrid | Grupo Expo |
| --- | --- | --- | --- |
| Binarios 1.0.10 y anteriores compatibles | 1.0.0 | 14:04 | `4b0be78c-bdca-4154-9881-ab3653e00eee` |
| Binarios 1.0.11 | 1.0.11 | 14:06 | `756a3985-729c-46ea-8776-791859295ac0` |

Ambos grupos incluyen Android e iOS. Los cuatro manifiestos públicos del canal `production` devolvieron los UUID esperados y el SHA-256 exacto del bundle correspondiente. La última verificación terminó a las 14:07, hora de Madrid. Las dependencias nativas específicas de cada runtime se conservaron y el código cliente de las dos variantes se comparó sin diferencias.

En Supabase se aplicó exclusivamente `20261108200000_participatory_discovery.sql`, que era la única migración pendiente. Se desplegó `sync-madrid-events`, conservando la validación JWT, el secreto existente y la tarea diaria. La sincronización real terminó con HTTP satisfactorio: **3 actividades aceptadas de 1.313 registros de origen**.

La comprobación pública devolvió las mismas tres actividades, cero pares duplicados, fechas/horas/coordenadas completas y filtros de subcategoría correctos. Los resúmenes para invitados no expusieron identidades de participantes. Los registros históricos, integrantes y chats se conservan aunque una actividad deje de aparecer en descubrimiento.

Las nuevas fuentes de Meetup, Eventbrite y Citylife **no están activadas**. Sigue pendiente un acceso permitido para su importación continua. Ticketmaster permanece desactivado. Esta publicación no crea versiones de tienda ni cambia sus envíos; no se modificó `main` ni se hizo merge.

Validación previa: 18 archivos de pruebas aprobados, 232 comprobaciones SQL locales, TypeScript de ambas variantes, ESLint sin errores (71 advertencias), vista previa en Chromium y exportaciones Hermes Android/iOS. No se han realizado pruebas en dispositivos reales, por lo que no se presenta el cierre del mapa como reproducido y resuelto en un móvil.

Para recibir la actualización: abrir NEXO con conexión a Internet, dejar que se descargue y cerrar y volver a abrir la aplicación si todavía aparece la interfaz anterior.

Evidencia con IDs, commits, hashes y resultado del backend: [social-discovery-production-2026-11-09.json](data/social-discovery-production-2026-11-09.json). Alcance y fuentes revisadas: [informe de revisión](social-discovery-review-2026-11-09.md). Los bundles están en `builds/ota/social-discovery-2026-11-09/`, ignorados por Git. **No repetir los comandos de publicación de esta entrega: ambos grupos ya existen.**
