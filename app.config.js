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

function iosUrlSchemeFromClientId(clientId) {
  const trimmed = String(clientId || '').trim();
  const suffix = '.apps.googleusercontent.com';
  if (!trimmed.endsWith(suffix)) return '';
  const id = trimmed.slice(0, -suffix.length);
  return id ? `com.googleusercontent.apps.${id}` : '';
}

module.exports = () => {
  const mapsKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  const googleIosUrlScheme = iosUrlSchemeFromClientId(googleIosClientId);

  const expo = { ...appJson.expo };
  const android = { ...expo.android };
  const extra = { ...(expo.extra || {}) };
  const plugins = [...(expo.plugins || [])];

  if (mapsKey) {
    android.config = {
      ...(android.config || {}),
      googleMaps: { apiKey: mapsKey },
    };
  }

  extra.googleMapsConfigured = Boolean(mapsKey);

  plugins.push('expo-apple-authentication');
  if (googleIosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleIosUrlScheme },
    ]);
  } else {
    plugins.push('@react-native-google-signin/google-signin');
  }

  return {
    expo: {
      ...expo,
      android,
      plugins,
      extra,
    },
  };
};
