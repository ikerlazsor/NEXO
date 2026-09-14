import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const UPDATE_CHECK_TIMEOUT_MS = 12_000;

let startupFetchPromise: Promise<boolean> | null = null;
/** Update ya descargado; se aplica al ir a background o en el próximo cold start. */
let pendingReload = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/**
 * Comprueba y descarga un OTA sin reiniciar la app.
 * Así el splash/feed no se bloquean; el bundle nuevo queda listo para el siguiente arranque
 * o para un reload al pasar a background.
 */
export async function checkAndFetchAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  try {
    const result = await withTimeout(Updates.checkForUpdateAsync(), UPDATE_CHECK_TIMEOUT_MS);
    if (!result?.isAvailable) return false;

    const fetched = await withTimeout(Updates.fetchUpdateAsync(), UPDATE_CHECK_TIMEOUT_MS);
    if (!fetched?.isNew) return false;

    pendingReload = true;
    return true;
  } catch {
    return false;
  }
}

/** Aplica el OTA ya descargado (reinicio JS). No usar durante el splash. */
export async function applyFetchedAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled || !pendingReload) return false;
  try {
    pendingReload = false;
    await Updates.reloadAsync();
    return true;
  } catch {
    pendingReload = true;
    return false;
  }
}

/**
 * Arranque: solo dispara la descarga en segundo plano (no await-friendly de bloqueo).
 * No llama a reloadAsync → no deja la animación de carga colgada.
 */
export function ensureStartupAppUpdateCheck(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve(false);
  if (!startupFetchPromise) {
    startupFetchPromise = checkAndFetchAppUpdate();
  }
  return startupFetchPromise;
}

/**
 * Al volver a foreground: descarga en silencio.
 * Al ir a background: si hay update listo, lo aplica para que al volver ya esté la versión nueva
 * (sin forzar doble entrada ni splash eterno).
 */
export function startAppUpdateListener(): () => void {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  let inFlight = false;
  const fetchQuietly = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await checkAndFetchAppUpdate();
    } finally {
      inFlight = false;
    }
  };

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      void fetchQuietly();
      return;
    }
    if (state === 'background' || state === 'inactive') {
      if (pendingReload) void applyFetchedAppUpdate();
    }
  });
  return () => sub.remove();
}
