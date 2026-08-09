# Despliegue de seguridad

Los cambios de esta rama eliminan el acceso por nombre de usuario, dejan de guardar contraseñas de registro en AsyncStorage, corrigen la declaración de `inviteHandled` y protegen `expand-search-query` con autenticación, longitud máxima y una cuota de 30 solicitudes por usuario y hora.

## 1. Base de datos

En Supabase Dashboard, abre **SQL Editor**, pega todo el contenido de:

`supabase/security-hardening.sql`

y pulsa **Run** una sola vez.

Después ejecuta también `supabase/security-hardening-phase2.sql`. Este segundo script impide consultar públicamente si un correo está registrado.

## 2. Edge Function opcional

`expand-search-query` usa OpenAI. Como no se va a configurar una clave, no es necesario desplegarla. El resto de cambios de seguridad funciona sin esa función y sin ejecutar comandos adicionales en Bash.
