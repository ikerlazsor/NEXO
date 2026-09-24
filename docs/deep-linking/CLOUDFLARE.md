# Cloudflare Builds — IMPORTANT

En el panel del Worker **nexoo**:

| Campo | Valor |
|--------|--------|
| **Root directory** | `site` |
| Build command | None |
| Deploy command | `npx wrangler deploy` |

Así Cloudflare **no** ejecuta `npm ci` del monorepo Expo (que es lo que falló).

```bash
git add -A site/ wrangler.toml
git commit -m "Cloudflare deploy desde site/ sin npm ci"
git push origin main
```

Luego cambia Root directory a `site` y Retry.
