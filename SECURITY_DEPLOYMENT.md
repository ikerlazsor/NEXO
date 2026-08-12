# Despliegue de seguridad y privacidad

Los cambios de seguridad son migraciones versionadas. No se deben copiar
scripts sueltos en SQL Editor ni desplegar funciones antiguas.

## Base de datos

En un entorno local limpio:

```bash
supabase start
supabase db reset
supabase test db
```

La migración `20260812042724_market_readiness_hardening.sql` añade la
proyección de perfiles con privacidad, reserva de nombres de usuario, reportes
de mensajes, limpieza física de Storage y permisos de mínimo privilegio.

Para un proyecto enlazado, inspecciona primero el cambio y aplica únicamente
las migraciones pendientes:

```bash
supabase db push --dry-run
supabase db push
supabase inspect db --linked
```

Nunca ejecutes `supabase db reset --linked` contra producción.

## Edge Functions obligatorias

Despliega `delete-account` y `delete-plan`. Ambas usan el `service_role`
inyectado por Supabase para eliminar primero los objetos físicos y después los
registros relacionados. No configures esa clave en la app cliente.

```bash
supabase functions deploy delete-account
supabase functions deploy delete-plan
```

Este despliegue no requiere OpenAI, Sentry ni ningún servicio de pago.
