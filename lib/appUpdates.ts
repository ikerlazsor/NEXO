import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const UPDATE_CHECK_TIMEOUT_MS = 12_000;

let startupCheckPromise: Promise<boolean> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/**
 * Comprueba, descarga y aplica (reload) un OTA de EAS si hay uno nuevo.
 * En __DEV__ o sin updates habilitado no hace nada.
 */
export async function checkAndApplyAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  try {
    const result = await withTimeout(Updates.checkForUpdateAsync(), UPDATE_CHECK_TIMEOUT_MS);
    if (!result?.isAvailable) return false;

    const fetched = await withTimeout(Updates.fetchUpdateAsync(), UPDATE_CHECK_TIMEOUT_MS);
    if (!fetched?.isNew) return false;

    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}

/** Arranque en frío: comprobar OTA una sola vez mientras sigue el splash nativo. */
export function ensureStartupAppUpdateCheck(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve(false);
  if (!startupCheckPromise) {
    startupCheckPromise = checkAndApplyAppUpdate();
  }
  return startupCheckPromise;
}

/**
 * Vuelve a comprobar al volver de background (p. ej. si publicaste OTA con la app abierta).
 */
export function startAppUpdateListener(): () => void {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  let inFlight = false;
  const check = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await checkAndApplyAppUpdate();
    } finally {
      inFlight = false;
    }
  };

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void check();
  });
  return () => sub.remove();
}
