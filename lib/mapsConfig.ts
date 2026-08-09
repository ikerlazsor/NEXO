import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

/** Expo Go ya trae credenciales de mapas; el APK/standalone necesita API key en el build. */
export function isNativeMapsAvailable(): boolean {
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
        return true;
    }
    return Boolean(
        (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
            ?.googleMapsConfigured,
    );
}

/** En Android standalone hace falta Google; en iOS Apple Maps no necesita key de Google. */
export function nexoMapProvider() {
    if (Platform.OS === 'android' && isNativeMapsAvailable()) {
        return PROVIDER_GOOGLE;
    }
    return undefined;
}
