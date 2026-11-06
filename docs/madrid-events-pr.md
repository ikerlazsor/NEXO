Añade un feed con Para ti, Planes y Agenda, manteniendo las tarjetas y el ranking social actuales. Los eventos externos tienen tarjetas compactas/editoriales, ficha oficial, alta social explícitamente separada de la reserva y chat de texto propio con participantes, bloqueos y bajas.

Reutiliza y amplía el prototipo de #41 y su paginación por fecha+ID. Añade migración versionada con RLS, importación atómica e idempotente, ciclo de vida y workflow diario desactivado. No incorpora #43 ni modifica producción/main.

Validación: 22 casos unitarios, 48 tests SQL específicos y smoke HTTP local con cuentas sintéticas aprobados; vista previa visual Chromium y bundles Android/iOS. El lint/TypeScript global, la compatibilidad Expo y la auditoría mantienen los fallos previos tratados por #43. Las pruebas SQL históricas también tienen fallos documentados.

No activar el proveedor todavía: el acceso a datos.madrid.es está bloqueado y no se han verificado el JSON y las condiciones de reutilización vigentes. Faltan validación municipal en staging, revisión de la cola de denuncias, cron aprobado y pruebas Android/iOS reales. La imagen PostgreSQL local mostró un fallo en la ruta de funciones sin privilegios, documentado en el informe.

Revisión visual: npm run events:preview; capturas e informe completo en docs/madrid-events-pilot.md.
