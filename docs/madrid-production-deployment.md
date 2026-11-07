# Despliegue de eventos de Madrid

La autorización para activar Supabase y distribuir la app se recibió el 7 de noviembre de 2026. Se omiten las pruebas manuales en dispositivos a petición del usuario. El resultado real de cada despliegue debe registrarse por separado: preparar estos comandos no acredita que se hayan ejecutado.

Estado comprobado: backend desplegado, proveedor habilitado, 1.385 actividades y tarea diaria probada con HTTP 200. El bloqueo de red de subida está resuelto. Ambos builds nativos finalizaron; iOS ya está enviado a App Store Connect. Google rechazó Android porque producción no tiene países habilitados: hay que configurarlos en Play Console antes de reintentar el mismo build. La aprobación/publicación de las tiendas sigue pendiente. Consultar los IDs y el estado observado en [estado actual](madrid-events-launch.md) antes de reejecutar comandos.

## Acceso

- `SUPABASE_ACCESS_TOKEN`: token personal de [Supabase](https://supabase.com/dashboard/account/tokens), configurado en los secretos seguros del entorno y limitado al destino `api.supabase.com`.
- `EXPO_TOKEN`: token de [la cuenta Expo ikerlazsor](https://expo.dev/accounts/ikerlazsor/settings/access-tokens), configurado en los secretos seguros del entorno. No se guardan tokens en Git ni se pegan en el chat.
- Destino fijo del backend: `nixeproyzxvqzyrvsxcx`. El perfil móvil es `production` del proyecto Expo `edde1434-fc73-4e3b-a3c6-cd46fe2f6a8e`.

## Backend y actualización diaria

```sh
# Consulta el historial y el esquema y descarga la fuente; no cambia el servidor.
NODE_USE_ENV_PROXY=1 npm run events:production

# Aplica exclusivamente las cuatro migraciones de esta funcionalidad, despliega
# la función, configura su secreto y activa la primera carga completa.
NODE_USE_ENV_PROXY=1 npm run events:production -- --apply
```

El proyecto remoto contiene migraciones manuales con fechas distintas a las del repositorio. El despliegue comprueba las 304 columnas y nueve firmas RPC del contrato base revisado, además de PostgreSQL 17; no vuelve a aplicar migraciones históricas ni inventa sus registros. Cada migración nueva se registra en la misma transacción que la aplica.

La función `sync-madrid-events` se genera desde los mismos módulos de clasificación, normalización e importación que se prueban en Node. Se despliega antes de habilitar el proveedor y conserva la validación JWT de la pasarela. Su secreto interno se guarda en Edge Secrets y en Vault; el programador usa un JWT público `anon` para la pasarela y no almacena una clave `service_role`. Un redeploy reutiliza el secreto existente. Activación, configuración de Vault y primera importación comparten una transacción.

El despliegue utiliza el multipart oficial de Management API (`/functions/deploy`), con `verify_jwt: true` explícito y comprobado en la respuesta. Esto permite usar el token a través del proxy seguro sin extraer su valor para satisfacer la validación local del CLI. No se desactiva la autenticación de la pasarela.

`pg_cron` invoca la función diariamente a las 05:20 UTC. No depende del cron de GitHub ni de modificar `main`. El proveedor deshabilitado o no revisado no genera solicitudes. Las peticiones a Edge sin el secreto interno se rechazan antes de acceder a la fuente. El despliegue comprueba el estado final y vuelve a importar mediante la función ya desplegada.

Control operativo: revisar `event_providers.last_success_at` y la respuesta HTTP de Edge. Una antigüedad superior a 36 horas requiere investigar la tarea; una ejecución cron que solo encola HTTP no demuestra que la importación haya terminado. Consultar `cron.job_run_details` y `net._http_response` sin copiar cabeceras o secretos a informes. Para ocultar inmediatamente la agenda, deshabilitar el proveedor; se conservan los datos y participantes.

## Distribución móvil

La versión es **1.0.11**, con runtime derivado de la versión. Se necesita un binario nuevo por el cambio previo de `react-native-view-shot`. Una OTA con ese runtime no actualizaría los binarios 1.0.10 existentes. Primero se compila para las tiendas con las credenciales ya configuradas en Expo; después se envían los artefactos concretos, evitando seleccionar accidentalmente un build anterior.

```sh
npm exec --yes --package=eas-cli@27.5.0 -- eas build \
  --profile production --platform all --non-interactive --no-wait --freeze-credentials
# Cuando finalice cada build, usar su ID real:
# ... eas submit --profile production --platform android --id BUILD_ID --non-interactive
# ... eas submit --profile production --platform ios --id BUILD_ID --non-interactive
```

Compilación, envío a las tiendas, revisión de Apple/Google y disponibilidad pública son estados distintos. Un envío a TestFlight o un build finalizado no se presenta como una versión ya pública. No se cambian planes de pago ni se contratan servicios nuevos.

## Decisiones y verificación

- Archivado global movido a `pg_cron` cada cinco minutos; se retira el permiso de ejecución al cliente y su llamada móvil.
- Se conserva el contrato explícito de `20261007150000`: un enlace UUID permite leer un meetup privado/solo amigos, que permanece oculto del feed. No permite abrir chats directos o grupales. La prueba antigua se actualiza a ese contrato y se añaden casos negativos de chats y planes cancelados; no se cambian permisos para aprobarla.
- Se conservan los días excluidos del JSON en el horario. Los rangos incluyen un aviso para consultar las sesiones y apertura en la web oficial. No se fabrican sesiones reservables.
- Verificación local: 166 comprobaciones SQL aprobadas; ocho regresiones de despliegue/autenticación; suite unitaria completa, TypeScript y lint sin errores; Chromium confirma ambas tarjetas y el botón sin «+». No se han realizado pruebas nativas en dispositivos.
