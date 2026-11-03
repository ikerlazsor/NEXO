import { AppState, Keyboard, Platform, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const UPDATE_CHECK_TIMEOUT_MS = 12_000;
/** Con la app abierta: cada cuánto se busca una OTA nueva. */
const FOREGROUND_POLL_MS = 60_000;
/** Update listo pero el momento no es seguro (subiendo, escribiendo…): reintento. */
const BUSY_RETRY_MS = 3_000;
/**
 * Único margen tras arrancar: deja que el runtime termine de montarse.
 * Cuanto antes se aplique, menos “salto”: durante el splash el reinicio es invisible.
 */
const MIN_UPTIME_BEFORE_RELOAD_MS = 1_200;

const bootedAt = Date.now();

let startupFetchPromise: Promise<boolean> | null = null;
/** Update ya descargado; se aplica en cuanto sea seguro (o al ir a background). */
let pendingReload = false;
/** Login / registro / OTP: no reiniciar. */
let reloadBlockedForAuth = false;
/** Tras salir del login: no recargar en los primeros segundos (parece un “corte”). */
let authGraceUntil = 0;
/** reloadAsync ya lanzado: no volver a lanzarlo. */
let reloading = false;
// 'unknown' al arrancar en iOS: tratarlo como activo (si no, nunca se aplicaría).
let appActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
let keyboardVisible = false;
/** Operaciones que no se pueden interrumpir (subidas, publicar plan, guardar perfil…). */
const reloadHolds = new Set<number>();
let holdSeq = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (!blocked) scheduleReloadWhenSafe();
}

/** Bloquea el OTA un rato tras login/registro (SIGNED_IN + cambio de pantalla). */
export function markAuthTransitionGrace(ms = 20_000): void {
  authGraceUntil = Date.now() + ms;
  setTimeout(() => {
    if (!isAuthGraceActive()) scheduleReloadWhenSafe();
  }, ms + 50);
}

function isAuthGraceActive(): boolean {
  return Date.now() < authGraceUntil;
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
    scheduleReloadWhenSafe();
  };
}

/** True si hay un OTA descargado esperando aplicarse. */
export function isAppUpdatePending(): boolean {
  return pendingReload;
}

/** Momento seguro = app en primer plano, nada en curso y sin teclado abierto. */
function isSafeToReloadNow(): boolean {
  if (reloading || !pendingReload) return false;
  if (reloadBlockedForAuth || isAuthGraceActive()) return false;
  if (!appActive) return false;
  if (reloadHolds.size > 0) return false;
  // Teclado abierto = el usuario está escribiendo: reiniciar perdería el texto.
  if (keyboardVisible) return false;
  return Date.now() - bootedAt >= MIN_UPTIME_BEFORE_RELOAD_MS;
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Aplica el OTA en cuanto se pueda, sin bloquear nada:
 * si el momento no es seguro, reintenta hasta que lo sea.
 */
function scheduleReloadWhenSafe(): void {
  if (!pendingReload || reloading) {
    clearRetryTimer();
    return;
  }
  if (isSafeToReloadNow()) {
    clearRetryTimer();
    void applyFetchedAppUpdate();
    return;
  }
  if (retryTimer) return;
  // Si lo único que falta es el margen de arranque, esperar justo eso (no 3 s).
  const uptimeLeft = MIN_UPTIME_BEFORE_RELOAD_MS - (Date.now() - bootedAt);
  const delay = uptimeLeft > 0 ? Math.min(uptimeLeft + 50, BUSY_RETRY_MS) : BUSY_RETRY_MS;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    scheduleReloadWhenSafe();
  }, delay);
}

/**
 * Comprueba y descarga un OTA sin reiniciar por su cuenta.
 * Con `applyWhenReady` el reinicio se intenta en cuanto el momento sea seguro,
 * así la actualización entra sin salir de la app.
 */
export async function checkAndFetchAppUpdate(opts?: { applyWhenReady?: boolean }): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  try {
    const result = await withTimeout(Updates.checkForUpdateAsync(), UPDATE_CHECK_TIMEOUT_MS);
    if (!result?.isAvailable) return false;

    const fetched = await withTimeout(Updates.fetchUpdateAsync(), UPDATE_CHECK_TIMEOUT_MS);
    if (!fetched?.isNew) return false;

    pendingReload = true;
    if (opts?.applyWhenReady !== false) scheduleReloadWhenSafe();
    return true;
  } catch {
    return false;
  }
}

/** Aplica el OTA ya descargado (reinicio del bundle JS). */
export async function applyFetchedAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled || !pendingReload || reloading) return false;
  if (reloadBlockedForAuth || isAuthGraceActive()) return false;
  reloading = true;
  pendingReload = false;
  clearRetryTimer();
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // Sin reintento inmediato: se aplicará al ir a background o en el próximo arranque.
    reloading = false;
    pendingReload = true;
    return false;
  }
}

/**
 * Arranque: dispara la descarga en segundo plano (no bloquea el splash) y aplica
 * en cuanto llega. Si cae durante el splash, el reinicio ni se nota.
 */
export function ensureStartupAppUpdateCheck(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve(false);
  if (!startupFetchPromise) {
    startupFetchPromise = checkAndFetchAppUpdate({ applyWhenReady: true });
  }
  return startupFetchPromise;
}

/**
 * Mientras la app está abierta: busca OTA periódicamente y la aplica en reposo.
 * Al ir a background: aplica la que hubiera pendiente.
 */
export function startAppUpdateListener(): () => void {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  let inFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const fetchQuietly = async () => {
    if (inFlight || reloading) return;
    inFlight = true;
    try {
      await checkAndFetchAppUpdate({ applyWhenReady: true });
    } finally {
      inFlight = false;
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!appActive || reloading) return;
      if (pendingReload) {
        scheduleReloadWhenSafe();
        return;
      }
      void fetchQuietly();
    }, FOREGROUND_POLL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  const onKeyboardShow = Keyboard.addListener(showEvent, () => {
    keyboardVisible = true;
  });
  const onKeyboardHide = Keyboard.addListener(hideEvent, () => {
    keyboardVisible = false;
    scheduleReloadWhenSafe();
  });

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    appActive = state === 'active';
    if (appActive) {
      startPolling();
      if (pendingReload) scheduleReloadWhenSafe();
      else void fetchQuietly();
      return;
    }
    stopPolling();
    clearRetryTimer();
    if (pendingReload && !reloadBlockedForAuth && !isAuthGraceActive()) {
      void applyFetchedAppUpdate();
    }
  });

  // Primera comprobación ya: cuanto antes entre, menos “salto” para el usuario.
  void ensureStartupAppUpdateCheck();
  startPolling();

  return () => {
    stopPolling();
    clearRetryTimer();
    onKeyboardShow.remove();
    onKeyboardHide.remove();
    sub.remove();
  };
}
