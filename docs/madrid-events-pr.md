Añade la agenda social de Madrid con Para ti, Planes y Agenda; fichas, participantes y chat propios; portadas del catálogo completo de las 6 categorías/30 subcategorías; botones compartidos con PlanCard sin «+» en eventos. La fecha queda bajo el título y no hay frase introductoria ni estrellas en Para ti. El perfil abre desde abajo con datos inmediatos y descarta lecturas anteriores a una edición o cambio de cuenta.

Reutiliza las correcciones Android/dependencias de #43 y corrige privacidad, colas offline, duplicados de chat y estados cruzados entre cuentas. Conserva el contrato documentado de enlaces UUID para leer meetups privados ocultos del feed; añade casos negativos de chats/cancelados. El archivado global se traslada al servidor y deja de ser una API del cliente.

Tras la autorización del usuario se desplegaron las cuatro migraciones en Supabase de producción y la función de importación con JWT activo más secreto interno. Madrid está habilitado con 1.385 actividades. Se comprobaron API pública, filtro, ficha, denegaciones y el recorrido real pg_cron → Edge → sincronización (HTTP 200). Las migraciones antiguas con fechas manuales se conservaron tras revisar el esquema físico; el historial de las cuatro nuevas coincide con su fuente.

Validación: TypeScript y suite unitaria (13 archivos) pasan; 166 comprobaciones SQL locales aprobadas; ESLint 0 errores/72 advertencias previas; Chromium para ambas tarjetas y catálogo; exportaciones Hermes Android/iOS. Auditoría previa: 0 críticos y 18 altos pendientes. Las pruebas en dispositivos se omiten por instrucción del usuario.

Distribución móvil pendiente: versión 1.0.11 con runtime por versión para requerir un binario compatible. La subida de EAS falló con 403 por el dominio `storage.googleapis.com`; su permiso está guardado en el borrador del entorno y aún no está aplicado. No hay build nuevo en cola, envío a tiendas, OTA ni versión pública nueva. No se modifica `main` ni se hace merge.

Informes: `docs/madrid-events-launch.md`, `docs/madrid-production-deployment.md`, `docs/data/madrid-production-deployment-2026-11-07.json` y `docs/event-card-design.md`. Capturas: `docs/screenshots/`.
