import * as SplashScreen from 'expo-splash-screen';

let hideStarted = false;

/** Oculta el splash nativo una sola vez por arranque (evita errores de VC en iOS). */
export async function hideNativeSplashOnce(): Promise<void> {
    if (hideStarted) return;
    hideStarted = true;
    try {
        await SplashScreen.hideAsync();
    } catch {
        /* Ya oculto o sin VC registrado (reload OTA, rutas secundarias). */
    }
}
