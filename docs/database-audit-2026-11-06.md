# Auditoría de seguridad SQL · 6 de noviembre de 2026

La revisión se realizó sobre las migraciones del repositorio y el stack **Supabase local**, con cuentas y eventos sintéticos. No se leyó ni modificó la base remota/producción. La migración correctiva es `20261106190000_restore_reviewed_api_boundaries.sql`; debe revisarse antes de desplegarse.

## Hallazgos corregidos

1. **Permisos amplios restauraban RPCs retiradas.** La migración `20261027120000` otorgaba ALL sobre tablas, secuencias y funciones a `anon`/`authenticated`, además de permisos futuros y un event trigger que repetía el grant. Reabría funciones de borrado de cuentas/planes y administración previamente retiradas. La corrección retira el acceso anónimo a tablas/secuencias, limita RPCs anónimas a las seis APIs públicas actuales (usuario disponible, feed, búsqueda, ficha compartida y dos APIs de agenda) y vuelve a restringir funciones de borrado/limpieza/push internas a servicio. Conserva los RPCs y CRUD autenticados necesarios para las pantallas. Las funciones trigger no son APIs de cliente.
2. **Datos y columnas privadas de perfiles.** El grant ALL también anulaba la frontera de columnas de perfil y dejaba leer fechas de nacimiento y escribir columnas de control mediante la Data API. Se restauran los grants revisados, conservando columnas posteriores necesarias para comunidades/directorio, preferencias y escritura de idioma. Se retira la inserción directa de snapshots de denuncias; continúa disponible la RPC validada `report_message`.
3. **El bundle del perfil público omitía las preferencias de privacidad.** `get_profile_screen` devolvía DOB, gustos y hábitos completos de otra persona. Ahora reutiliza `get_public_profiles`, que ya incorpora bloqueos y redacción por preferencias, añade edad pública y oculta la fecha de nacimiento ajena. La ficha propia conserva su DOB y datos completos para mantener la edición y carga inmediata. El cliente debe usar el nuevo campo `edad` para otras personas (corrección coordinada en el cliente).
4. **Kill-switch del proveedor incompleto.** Deshabilitar la agenda ocultaba las tarjetas, pero un usuario identificado podía seguir enumerando participantes y un miembro podía leer el chat. Las políticas/RPCs ahora requieren proveedor habilitado y revisión de formato/licencia para fichas, páginas, roster, lectura de chat, altas y nuevas interacciones. Se conserva la posibilidad de abandonar un evento deshabilitado.
5. **Idempotencia podía confirmar el chat equivocado.** Reutilizar el mismo UUID de envío en otro evento o con otro texto devolvía el ID antiguo como si el nuevo envío hubiera sido correcto. La función ahora rechaza esa reutilización con `message_client_conflict` sin insertar mensajes adicionales.
6. **Objetos futuros abiertos por defecto.** Las nuevas tablas y funciones exigen grants explícitos al cliente. El event trigger se mantiene con concesiones exclusivamente a postgres/servicio. Se preservan sus objetos y todos los datos; no hay drops de tablas ni limpieza de datos de la app.

## Comprobaciones

Aplicación local (sin `--linked`, `--remote` ni parámetros de producción):

```sh
docker --host=unix:///var/run/docker.sock exec -i supabase_db_nexo \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/migrations/20261106190000_restore_reviewed_api_boundaries.sql
npx supabase test db supabase/tests/database/api_boundaries_regression.test.sql \
  supabase/tests/database/external_events.test.sql
```

Resultado: **87/87 comprobaciones** (39 de regresiones de API/privacidad + 48 de eventos). Comprueban grants actuales/futuros, privilegios de columnas, edad/DOB ajena y propia, preferencias de privacidad, proveedor deshabilitado/no verificado, baja, idempotencia y las comprobaciones anteriores de chat/paginación/importación.

Los fixtures que crean funciones temporales llevan grants explícitos a sus roles de prueba, pues los nuevos defaults están cerrados. Las denegaciones de EXECUTE se comprueban con `has_function_privilege`: esta imagen local PostgreSQL 17.6.1.105 mostró previamente SIGSEGV al ejecutar una función sin ese permiso. No se afirma que se haya probado esa ruta de error del motor satisfactoriamente.

La batería completa ejecuta **144 comprobaciones**. Los tests antiguos se actualizaron solamente para la firma actual de `get_guest_feed`/`consume_ai_search_quota`, el conjunto de APIs públicas revisado y el conteo real de assertions. No se eliminan expectativas de privacidad ni se silencian fallos para aprobarla.

## Dos decisiones anteriores que siguen pendientes

- **Compartir planes privados por UUID:** `20261007150000` documenta expresamente que poseer el enlace permite abrir la ficha, aun siendo privada o solo amigos. El test antiguo espera lo contrario y falla. Se mantiene el comportamiento existente; cambiarlo requiere definir si el enlace es una invitación de lectura o si deben exigirse membresía/invitación explícita. No se ha debilitado el test que detecta esta diferencia.
- **Mantenimiento global desde el cliente:** `archive_all_ended_plans` sigue ejecutable por usuarios identificados porque la app lo llama en `lib/planLifecycle.ts`; el test histórico espera que no sea una API cliente. Se ha retirado el acceso anónimo, pero retirar también el autenticado requiere mover ese trabajo a una tarea de servicio y actualizar el cliente de forma coordinada. La comprobación continúa fallando y no se presenta la suite global como aprobada.

Antes del lanzamiento público: aplicar y comprobar estas migraciones en un staging autorizado, probar los flows de perfiles/directorio/comunidades, revisar las dos decisiones anteriores y ejecutar la ruta de denegaciones en una versión soportada del motor. Los resultados locales no demuestran que los grants reales de producción coincidan todavía con el repositorio.
