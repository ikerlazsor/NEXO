import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import {
  parseAttemptedUpdate,
  serializeAttemptedUpdate,
  shouldReloadFetchedUpdate,
  type AttemptedUpdate,
} from './otaReloadPolicy';

/** Presupuesto de comprobación + descarga. Si se agota, la app abre con el bundle actual. */
const UPDATE_BUDGET_MS = 8_000;
const RELOAD_TIMEOUT_MS = 3_000;
const STORAGE_TIMEOUT_MS = 1_000;
const MIN_CHECK_GAP_MS = 15_000;
const APPLIED_UPDATE_KEY = 'nexo.ota.appliedUpdateId';

let startupInFlight: Promise<boolean> | null = null;
let lastCheckAt = 0;
/** Update descargado que no se pudo aplicar en el arranque. */
let pendingReload = false;
let pendingUpdateId: string | null = null;
let reloadInFlight = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  void promise.then(() => undefined, () => undefined);
  if (ms <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function updateIdFromManifest(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const id = (manifest as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

async function readAttemptedUpdate(): Promise<AttemptedUpdate | null> {
  try {
    const raw = await withTimeout(AsyncStorage.getItem(APPLIED_UPDATE_KEY), STORAGE_TIMEOUT_MS);
    return parseAttemptedUpdate(raw);
  } catch {
    return null;
  }
}

async function rememberAttemptedUpdate(updateId: string | null): Promise<void> {
  try {
    await withTimeout(
      AsyncStorage.setItem(APPLIED_UPDATE_KEY, serializeAttemptedUpdate(updateId, Date.now())),
      STORAGE_TIMEOUT_MS,
    );
  } catch {
    /* sin almacenamiento seguimos; el timeout evita el cuelgue */
  }
}

async function reloadAllowed(updateId: string | null): Promise<boolean> {
  const attempted = await readAttemptedUpdate();
  return shouldReloadFetchedUpdate(updateId, attempted, Date.now());
}

function notePending(manifest: unknown): void {
  pendingReload = true;
  pendingUpdateId = updateIdFromManifest(manifest);
}

function watchLateDownload(fetchPromise: Promise<Updates.UpdateFetchResult>): void {
  void fetchPromise
    .then(async (late) => {
      if (!late?.isNew) return;
      const updateId = updateIdFromManifest(late.manifest);
      if (!(await reloadAllowed(updateId))) return;
      notePending(late.manifest);
    })
    .catch(() => undefined);
}

/**
 * Comprueba y descarga un OTA sin reiniciar.
 * Si la red va lenta, resuelve false y deja la descarga seguir para aplicarla al ir a background.
 */
export async function checkAndFetchAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled || reloadInFlight) return false;
  if (startupInFlight) await startupInFlight;
  if (Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return pendingReload;

  const deadline = Date.now() + UPDATE_BUDGET_MS;
  const remaining = () => Math.max(0, deadline - Date.now());
  lastCheckAt = Date.now();

  try {
    const checkPromise = Updates.checkForUpdateAsync();
    const result = await withTimeout(checkPromise, remaining());
    if (!result) {
      void checkPromise
        .then(async (late) => {
          if (!late?.isAvailable || pendingReload) return;
          const updateId = updateIdFromManifest(late.manifest);
          if (!(await reloadAllowed(updateId))) return;
          const fetched = await Updates.fetchUpdateAsync();
          if (fetched?.isNew) notePending(fetched.manifest);
        })
        .catch(() => undefined);
      return false;
    }
    if (!result.isAvailable) return false;

    const updateId = updateIdFromManifest(result.manifest);
    if (!(await reloadAllowed(updateId))) return false;

    const fetchPromise = Updates.fetchUpdateAsync();
    const fetched = await withTimeout(fetchPromise, remaining());
    if (!fetched) {
      watchLateDownload(fetchPromise);
      return false;
    }
    if (!fetched.isNew) return false;

    notePending(fetched.manifest);
    return true;
  } catch {
    return false;
  }
}

/** Aplica un OTA ya descargado. Si el reload no ocurre, la app sigue con el bundle actual. */
export async function applyFetchedAppUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled || !pendingReload || reloadInFlight) return false;
  const updateId = pendingUpdateId;
  if (!(await reloadAllowed(updateId))) {
    pendingReload = false;
    pendingUpdateId = null;
    return false;
  }
  await rememberAttemptedUpdate(updateId);
  reloadInFlight = true;
  pendingReload = false;
  try {
    const reloaded = await withTimeout(Updates.reloadAsync(), RELOAD_TIMEOUT_MS);
    reloadInFlight = false;
    if (reloaded === null) {
      pendingReload = true;
      return false;
    }
    return true;
  } catch {
    pendingReload = true;
    reloadInFlight = false;
    return false;
  }
}

/**
 * Con el splash visible: descarga la última versión publicada y recarga antes de
 * enseñar la interfaz. Cualquier fallo o timeout abre la versión que ya está instalada.
 * Si el reload reinicia el runtime, esta promesa no sigue y el nuevo arranque ya es la versión nueva.
 */
export function applyAvailableUpdateBeforeReveal(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve(false);
  if (!startupInFlight) {
    const run = runStartupUpdate();
    startupInFlight = run.finally(() => {
      startupInFlight = null;
    });
  }
  return startupInFlight;
}

async function runStartupUpdate(): Promise<boolean> {
  const deadline = Date.now() + UPDATE_BUDGET_MS;
  const remaining = () => Math.max(0, deadline - Date.now());
  lastCheckAt = Date.now();

  try {
    const checkPromise = Updates.checkForUpdateAsync();
    const result = await withTimeout(checkPromise, remaining());
    if (!result) {
      void checkPromise
        .then(async (late) => {
          if (!late?.isAvailable) return;
          const updateId = updateIdFromManifest(late.manifest);
          if (!(await reloadAllowed(updateId))) return;
          const fetched = await Updates.fetchUpdateAsync();
          if (fetched?.isNew) notePending(fetched.manifest);
        })
        .catch(() => undefined);
      return false;
    }
    if (!result.isAvailable) return false;

    const announcedId = updateIdFromManifest(result.manifest);
    if (!(await reloadAllowed(announcedId))) return false;

    const fetchPromise = Updates.fetchUpdateAsync();
    const fetched = await withTimeout(fetchPromise, remaining());
    if (!fetched?.isNew) {
      if (!fetched) watchLateDownload(fetchPromise);
      return false;
    }

    const updateId = updateIdFromManifest(fetched.manifest) ?? announcedId;
    if (!(await reloadAllowed(updateId))) return false;

    await rememberAttemptedUpdate(updateId);
    if (reloadInFlight) return false;
    reloadInFlight = true;
    pendingReload = false;
    pendingUpdateId = updateId;
    try {
      const reloaded = await withTimeout(Updates.reloadAsync(), RELOAD_TIMEOUT_MS);
      reloadInFlight = false;
      if (reloaded === null) {
        pendingReload = true;
        return false;
      }
      // Si el runtime sigue vivo, no bloquear el splash: el reload no llegó a reiniciar.
      return false;
    } catch {
      pendingReload = true;
      reloadInFlight = false;
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Mientras la app está abierta, descarga en silencio al volver a primer plano.
 * Al ir a background aplica un update que no cupo en el arranque.
 */
export function startAppUpdateListener(): () => void {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  let inFlight = false;
  const fetchQuietly = async () => {
    if (inFlight || reloadInFlight) return;
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
