import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../../lib/supabase";
import { setEventSaved } from "./api";

/**
 * Eventos guardados del usuario, compartidos entre la tarjeta del feed, la ficha
 * y Guardados: guardar en un sitio se ve al instante en los demás.
 */
let owner: string | null = null;
let ids = new Set<string>();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const pending = new Set<string>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Carga (una vez por usuario) los ids guardados. */
export function loadSavedEvents(userId: string | null, force = false): Promise<void> {
  if (!userId) {
    if (owner !== null || ids.size) {
      owner = null;
      ids = new Set();
      emit();
    }
    return Promise.resolve();
  }
  if (owner === userId && loading && !force) return loading;
  if (owner !== userId) {
    owner = userId;
    ids = new Set();
    emit();
  }
  loading = (async () => {
    try {
      const { data, error } = await (supabase as unknown as { from: (t: string) => any })
        .from("external_event_saves")
        .select("event_id")
        .eq("user_id", userId)
        .limit(500);
      if (error || owner !== userId) return;
      const next = new Set<string>(((data ?? []) as { event_id: string }[]).map((r) => String(r.event_id)));
      // Lo que se está guardando/quitando ahora mismo manda sobre la lectura.
      for (const id of pending) {
        if (ids.has(id)) next.add(id);
        else next.delete(id);
      }
      ids = next;
      emit();
    } catch {
      /* sin red: se reintenta en la próxima carga */
    }
  })();
  return loading;
}

export function isEventSaved(eventId: string): boolean {
  return ids.has(eventId);
}

/** Cambio optimista; si el servidor falla se revierte y devuelve false. */
export async function toggleEventSaved(eventId: string): Promise<boolean> {
  if (pending.has(eventId)) return true;
  const next = !ids.has(eventId);
  pending.add(eventId);
  ids = new Set(ids);
  if (next) ids.add(eventId);
  else ids.delete(eventId);
  emit();
  try {
    await setEventSaved(eventId, next);
    return true;
  } catch {
    ids = new Set(ids);
    if (next) ids.delete(eventId);
    else ids.add(eventId);
    emit();
    return false;
  } finally {
    pending.delete(eventId);
  }
}

/** Marca local sin red (p. ej. al quitar desde Guardados, que ya llama al servidor). */
export function markEventSaved(eventId: string, saved: boolean) {
  if (ids.has(eventId) === saved) return;
  ids = new Set(ids);
  if (saved) ids.add(eventId);
  else ids.delete(eventId);
  emit();
}

const snapshot = () => ids;

/** Conjunto de ids guardados (se re-renderiza al cambiar). */
export function useSavedEventIds(userId: string | null): Set<string> {
  useEffect(() => {
    void loadSavedEvents(userId);
  }, [userId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
