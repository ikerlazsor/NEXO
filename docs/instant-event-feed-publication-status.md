# Carga y detalle de actividades publicados · 10 de noviembre de 2026

**Entrega posterior:** el [chat compartido y la navegación del 15 de noviembre](shared-chat-navigation-publication-status.md) ya están publicados y verificados. Este documento conserva el registro de la entrega del día 10.

**Backend y actualización OTA publicados en producción, con autorización expresa del usuario para esta nueva ronda.** La entrega corrige la carga tardía de actividades, unifica el mapa, amplía la selección social y renueva el detalle.

- El catálogo público devuelve **14 actividades confirmadas**, frente a 3. La descarga contiene 1.272 registros y se mantienen fecha/hora/lugar, horizonte de tres meses y exclusiones de espectáculos. Cero pares duplicados en la verificación pública.
- La caché se recupera durante el arranque y el catálogo público se consulta sin esperar a la sesión. Las peticiones simultáneas se comparten; una respuesta antigua del disco no sobrescribe la red.
- El mapa muestra planes y actividades juntos, sin «Con gente»/«Explorar» y conservando agrupamiento y colores por categoría.
- Nuevo detalle con portada, datos agrupados, integrantes Nexo, información y reservas y menos avisos. El mapa se monta al entrar su sección en pantalla, después de la transición. Se conserva mientras termina la animación de salida.

| Binarios compatibles | Runtime | Hora de Madrid | Grupo Expo |
| --- | --- | --- | --- |
| Instalaciones anteriores compatibles | 1.0.0 | 10:07 | `74ea6a6f-06b7-4a34-b7b7-3d6bd49ff0bf` |
| Versión 1.0.11 | 1.0.11 | 10:08 | `26ffd8f7-e8c0-4a48-8883-219f1bc98a74` |

Los cuatro manifiestos públicos devolvieron los UUID esperados y el SHA-256 exacto del bundle correspondiente. Última verificación: 10:09, hora de Madrid. Se conservaron las dependencias nativas de cada runtime; no hay una nueva versión de tienda.

Supabase recibió únicamente `20261110100000_social_workshop_discovery.sql` y el importador actualizado. La sincronización real devolvió 14 importaciones, con JWT y tarea diaria conservados. Se comprobaron filtros de subcategoría, coordenadas del detalle y privacidad de invitados. Los registros históricos, integrantes y chats permanecen conservados.

Validación: 18 archivos de pruebas, 242 comprobaciones SQL locales, API HTTP local con usuarios ficticios, TypeScript de ambas variantes, ESLint con 0 errores y 71 advertencias, Chromium y cuatro exportaciones Hermes. No se midió la fluidez ni se probó el mapa en un dispositivo real.

Las fuentes adicionales siguen sin activar por los motivos de acceso descritos en la revisión anterior. Ticketmaster continúa desactivado. No se modificó `main` ni se hizo merge.

Para recibir la actualización, abrir NEXO con conexión, dejar que se descargue y cerrar y volver a abrir si aún se ve la interfaz anterior. No repetir la publicación: ambos grupos ya existen.

[Revisión del cambio](instant-event-feed-review-2026-11-10.md) · [Evidencia, hashes y catálogo verificado](data/instant-event-feed-production-2026-11-10.json)
