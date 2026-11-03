import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

/**
 * iOS: Apple Maps, siempre.
 * Android: hay que montar MapView nativo. La key va en el manifiesto del AAB;
 * extra.googleMapsConfigured se recalculaba en cada OTA y apagaba el mapa
 * aunque el build ya tuviera la key.
 */
export function isNativeMapsAvailable(): boolean {
    return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** En Android standalone hace falta Google; en iOS Apple Maps no necesita key de Google. */
export function nexoMapProvider() {
    if (Platform.OS === 'android') return PROVIDER_GOOGLE;
    return undefined;
}
