import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Actualizaciones OTA sin saltos.
 *
 * La app descarga la actualización en silencio y NUNCA se reinicia mientras
 * alguien la está usando. La versión nueva entra:
 *  - la próxima vez que la app se abra desde cero (expo-updates arranca con la
 *    última descargada; el usuario ya está viendo el splash), o
 *  - al volver a la app tras llevar un rato largo fuera (AWAY_RELOAD_MS), que
 *    para el usuario es como abrirla de nuevo.
 * Salir 10 segundos a WhatsApp y volver no reinicia nada.
 */

const UPDATE_CHECK_TIMEOUT_MS = 12_000;
/** Con la app abierta: cada cuánto se busca una OTA nueva (solo descarga). */
const FOREGROUND_POLL_MS = 10 * 60_000;
/** Fuera de la app al menos este rato: al volver se aplica la OTA ya descargada. */
const AWAY_RELOAD_MS = 30 * 60_000;

let startupFetchPromise: Promise<boolean> | null = null;
/** Update ya descargado, pendiente de aplicarse. */
let pendingReload = false;
/** Login / registro / OTP: no reiniciar. */
let reloadBlockedForAuth = false;
/** Tras salir del login: no recargar en los primeros segundos. */
let authGraceUntil = 0;
/** reloadAsync ya lanzado: no volver a lanzarlo. */
let reloading = false;
/** Operaciones que no se pueden interrumpir (subidas, publicar plan, guardar perfil…). */
const reloadHolds = new Set<number>();
let holdSeq = 0;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Pantallas de auth: el OTA se descarga, pero no se aplica. */
export function setAppUpdateReloadBlocked(blocked: boolean): void {
  reloadBlockedForAuth = blocked;
}

/** Bloquea el OTA un rato tras login/registro. */
export function markAuthTransitionGrace(ms = 20_000): void {
  authGraceUntil = Date.now() + ms;
}

/**
 * Bloquea el reinicio por OTA durante una operación crítica.
 * Devuelve la función para liberarlo (llamar siempre en `finally`).
 */
export function holdAppUpdateReload(): () => void {
  const id = ++holdSeq;
  reloadHolds.add(id);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reloadHolds.delete(id);
  };
}

/** True si hay un OTA descargado esperando aplicarse. */
export function isAppUpdatePending(): boolean {
  return pendingReload;
}

function canReloadNow(): boolean {
  return (
    pendingReload &&
    !reloading &&
    !reloadBlockedForAuth &&
    Date.now() >= authGraceUntil &&
    reloadHolds.size === 0
  );
}

/** Comprueba y descarga un OTA. Nunca reinicia la app. */
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

/** Aplica el OTA ya descargado (reinicio del bundle JS). Solo al volver tras un rato fuera. */
export async function applyFetchedAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled || !canReloadNow()) return false;
  reloading = true;
  pendingReload = false;
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // Se aplicará en el próximo arranque en frío.
    reloading = false;
    pendingReload = true;
    return false;
  }
}

/** Arranque: descarga en segundo plano; se usará en el siguiente arranque. */
export function ensureStartupAppUpdateCheck(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve(false);
  if (!startupFetchPromise) {
    startupFetchPromise = checkAndFetchAppUpdate();
  }
  return startupFetchPromise;
}

/**
 * Mientras la app está abierta: busca OTA de vez en cuando (solo descarga).
 * Al volver tras más de AWAY_RELOAD_MS fuera: aplica la que hubiera pendiente.
 */
export function startAppUpdateListener(): () => void {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  let inFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let backgroundSince: number | null = null;

  const fetchQuietly = async () => {
    if (inFlight || reloading || pendingReload) return;
    inFlight = true;
    try {
      await checkAndFetchAppUpdate();
    } finally {
      inFlight = false;
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void fetchQuietly();
    }, FOREGROUND_POLL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      const awayFor = backgroundSince == null ? 0 : Date.now() - backgroundSince;
      backgroundSince = null;
      if (awayFor >= AWAY_RELOAD_MS && pendingReload) {
        void applyFetchedAppUpdate();
        return;
      }
      startPolling();
      void fetchQuietly();
      return;
    }
    if (state === 'background' && backgroundSince == null) backgroundSince = Date.now();
    stopPolling();
  });

  void ensureStartupAppUpdateCheck();
  startPolling();

  return () => {
    stopPolling();
    sub.remove();
  };
}
