# Deep linking — `appnexo.es`

La web pública vive en **`site/`** (HTML estático) del mismo repo `ikerlazsor/NEXO`.
No es un Next.js aparte. Vercel está enlazado al repo, pero el sitio usa `_headers` / `_redirects` (estilo Cloudflare Pages).

## iOS (listo en código)

- `site/.well-known/apple-app-site-association` → Team ID `WR5J2G5FV5`
- `site/plan/` + redirect `/plan/*`
- App: `applinks:appnexo.es` en `app.json`

## Publicar la web

```bash
git add site/
git commit -m "AASA Universal Links para appnexo.es"
git push
```

Luego comprueba: `https://appnexo.es/.well-known/apple-app-site-association`

Si tras el push sigue 404, en Cloudflare Pages / el host que sirva `site/` lanza un redeploy (Root Directory = `site`).

## Android (más adelante)

Pon el SHA-256 en `site/.well-known/assetlinks.json` y un build solo Android.
