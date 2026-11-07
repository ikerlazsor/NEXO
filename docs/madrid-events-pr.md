Prepara la agenda social de Madrid y corrige fallos de privacidad, sincronización y navegación. Mantiene las tres secciones del feed, elimina las estrellas de Para ti y sitúa la fecha de los eventos bajo el título. El perfil abre desde abajo sin esperar a red y descarta respuestas antiguas tras editar o cambiar de cuenta.

Reutiliza las correcciones existentes de #43. Corrige pérdidas de acciones offline y duplicados de chat con UUID, aísla participantes/mensajes por cuenta/evento y endurece el importador. Añade una migración correctiva de permisos, redacción de datos de perfiles y acceso al chat cuando se deshabilita el proveedor. Se adaptan invitaciones, sugerencias y valoraciones a las lecturas públicas revisadas.

Validación: TypeScript pasa; ESLint 0 errores y 72 advertencias previas; 67 casos unitarios; 87 pruebas SQL específicas; smoke HTTP local con cuentas ficticias; Chromium para diseño; bundles Hermes Android/iOS y compatibilidad Expo local. Auditoría: 0 críticos y 18 altos restantes. La suite SQL completa conserva 2 diferencias de diseño documentadas (enlaces privados por UUID y mantenimiento global desde cliente).

No se ha activado el proveedor ni escrito en producción ni publicado versiones/OTA. El JSON y la licencia municipales actuales siguen pendientes de acceso de red; el borrador del entorno contiene los dominios necesarios. Faltan decisiones de privacidad/mantenimiento, validación staging con catálogo real y pruebas nativas.

Informes: docs/app-audit-2026-11-06.md, docs/database-audit-2026-11-06.md, docs/madrid-events-launch.md. Capturas: docs/screenshots/.


Actualización de portadas: clasificador compartido de categorías/subcategorías, reutilización estable del catálogo local de fotos de Nexo en tarjetas y ficha, y migración de subcategorías con constraint. Cuatro regresiones unitarias nuevas y cinco SQL; pasan las 92 comprobaciones SQL específicas, TypeScript, lint sin errores y bundles Android/iOS. Capturas actualizadas. Fuente/licencia municipal y activación pública siguen pendientes de acceso y revisión.
