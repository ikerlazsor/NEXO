Prepara la agenda social de Madrid con las secciones Para ti, Planes y Agenda. Los eventos tienen ficha, participantes y chat propios, botones compartidos con las tarjetas de planes y portadas ilustrativas de las 6 categorías y 30 subcategorías existentes. La fecha queda bajo el título; no hay frase introductoria ni estrellas en Para ti. El perfil abre desde abajo con sus datos en memoria y descarta respuestas anteriores a una edición o cambio de cuenta.

Reutiliza las correcciones Android/dependencias de #43, endurece la importación y corrige pérdidas de acciones offline, duplicados de chat y cruces de estado entre cuentas. Las migraciones ajustan permisos, redacción de perfiles, clasificación y acceso a eventos cuando se desactiva su proveedor. La fuente oficial y su licencia CC BY 4.0 ya se han consultado: de 1.443 registros, 1.385 futuros/en curso se importaron correctamente en una transacción local revertida.

Validación:

- TypeScript, suite unitaria (12 archivos) y 92 comprobaciones SQL específicas aprobados; smoke HTTP local con cuentas sintéticas.
- ESLint: 0 errores, 72 advertencias anteriores. Auditoría de dependencias: 0 críticos, 18 altos pendientes.
- Chromium: tarjetas editorial/compacta, 30 subcategorías, ancho móvil y ausencia de errores JavaScript. Bundles Hermes Android/iOS exportados; compatibilidad Expo comprobada.
- La suite SQL completa conserva dos diferencias de diseño documentadas: enlaces privados por UUID y mantenimiento global desde cliente. No se ha verificado comportamiento nativo en dispositivos.

El proveedor y el workflow diario siguen desactivados. No se modifica `main`, no se hace merge, no se escribe en producción y no se publica OTA ni versión en tiendas. Faltan revisión de calendarios en staging, decisiones de privacidad/mantenimiento, despliegue de backend y pruebas nativas antes de una publicación autorizada.

Informes: [activación pública](docs/madrid-events-launch.md), [fuente oficial](docs/madrid-source-validation.md), [diseño y portadas](docs/event-card-design.md), [auditoría de app](docs/app-audit-2026-11-06.md) y [base de datos](docs/database-audit-2026-11-06.md). Capturas: `docs/screenshots/`.
