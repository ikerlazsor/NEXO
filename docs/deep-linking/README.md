# Deep linking — `appnexo.es`

## Estado

| Plataforma | App (Expo) | Web (`.well-known`) |
|---|---|---|
| **iOS** Universal Links | `applinks:appnexo.es` en `app.json` | AASA listo con Team ID `WR5J2G5FV5` |
| **Android** App Links | `intentFilters` en `app.json` | `assetlinks.json` pendiente de SHA-256 |

Puedes publicar **solo iOS** ahora. Android lo completas más adelante con el SHA-256 + un build solo Android (no hace falta rebuild de iOS).

## Qué hacer ahora (iOS)

1. En el repo **Next.js**, copia:
   - `docs/deep-linking/public/.well-known/apple-app-site-association` → `public/.well-known/apple-app-site-association`
   - (Opcional) `assetlinks.json` aún con placeholder; Android no verificará hasta poner el SHA-256 real.

2. Asegura ruta web `/plan/[id]` (aunque sea “Abrir en Nexo!”).

3. Despliega la web y comprueba:
   - `https://appnexo.es/.well-known/apple-app-site-association`
   - [CDN de Apple](https://app-site-association.cdn-apple.com/a/v1/appnexo.es)

4. Build nativo iOS (OTA no vale para associated domains):

```bash
eas build --platform ios --profile production --auto-submit
```

## Más adelante (Android)

1. Obtén el SHA-256 (Play Console → App integrity → App signing key certificate).
2. Ponlo en `assetlinks.json` y redeploy de la web.
3. Solo Android:

```bash
eas build --platform android --profile production
```
