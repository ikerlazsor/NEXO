/**
 * Config dinámica: inyecta Google Maps API key desde el entorno de EAS/local.
 * Sin key, el APK no crashea (NexoMapView usa fallback), pero el mapa no se ve.
 *
 * EAS (visibility sensitive o plaintext — no solo "secret" si quieres verla en app config):
 *   eas env:set preview --name GOOGLE_MAPS_API_KEY --value "AIza..." --type string --visibility sensitive
 * Local: GOOGLE_MAPS_API_KEY=... en .env (no commitear).
 *
 * Importante: NO añadir "react-native-maps" a plugins (no es config plugin de Expo).
 * La key va en android.config.googleMaps.apiKey.
 */
const appJson = require('./app.json');

module.exports = () => {
  const mapsKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';

  const expo = { ...appJson.expo };
  const android = { ...expo.android };
  const extra = { ...(expo.extra || {}) };

  if (mapsKey) {
    android.config = {
      ...(android.config || {}),
      googleMaps: { apiKey: mapsKey },
    };
  }

  extra.googleMapsConfigured = Boolean(mapsKey);

  return {
    expo: {
      ...expo,
      android,
      extra,
    },
  };
};
