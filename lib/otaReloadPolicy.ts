/** Si el mismo update se reintenta antes de esto, no se recarga (evita un bucle de splash). */
export const OTA_RELOAD_RETRY_MS = 60 * 60 * 1000;

export type AttemptedUpdate = { id: string; at: number };

export function attemptedUpdateKey(updateId: string | null): string {
  return updateId && updateId.length > 0 ? updateId : 'unknown';
}

export function serializeAttemptedUpdate(updateId: string | null, at: number): string {
  return JSON.stringify({ id: attemptedUpdateKey(updateId), at });
}

export function parseAttemptedUpdate(raw: string | null): AttemptedUpdate | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null;
    if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    return { id: parsed.id, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Recarga si es otro update, o el mismo solo después del periodo de espera.
 * Sin id, una sola clave "unknown" cubre ese intento.
 */
export function shouldReloadFetchedUpdate(
  updateId: string | null,
  attempted: AttemptedUpdate | null,
  nowMs: number,
): boolean {
  const key = attemptedUpdateKey(updateId);
  if (!attempted || attempted.id !== key) return true;
  return nowMs - attempted.at >= OTA_RELOAD_RETRY_MS;
}
