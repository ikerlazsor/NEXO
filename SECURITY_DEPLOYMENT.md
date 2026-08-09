# Despliegue de seguridad

Los cambios de esta rama eliminan el acceso por nombre de usuario, dejan de guardar contraseñas de registro en AsyncStorage, corrigen la declaración de `inviteHandled` y protegen `expand-search-query` con autenticación, longitud máxima y una cuota de 30 solicitudes por usuario y hora.

## 1. Base de datos

En Supabase Dashboard, abre **SQL Editor**, pega todo el contenido de:

`supabase/security-hardening.sql`

y pulsa **Run** una sola vez.

## 2. Edge Function

Desde una terminal situada en la carpeta del proyecto:

```bash
npx supabase login
npx supabase link --project-ref nixeproyzxvqzyrvsxcx
npx supabase secrets set OPENAI_API_KEY="TU_CLAVE_OPENAI"
npx supabase functions deploy expand-search-query
```

No pongas la clave real en GitHub ni en archivos `.env` versionados.

## 3. Comprobación

```bash
npx supabase functions list
```

La función `expand-search-query` debe aparecer como desplegada. Las peticiones sin una sesión válida recibirán HTTP 401; una consulta de más de 120 caracteres, HTTP 400; y al superar 30 solicitudes en una hora, HTTP 429.
