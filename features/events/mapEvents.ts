import { isPublishableEvent } from "../../lib/externalEventPolicy.cjs";
import { fetchEventPage, fetchEventSocialSummaries } from "./api";
import type { EventCursor, EventSocialSummary, ExternalEvent } from "./types";

/**
 * Todos los eventos del mapa, cargados en segundo plano desde que arranca la
 * app. Antes el mapa los pedía de 30 en 30 encadenando renders y, si una
 * página fallaba, se quedaba a medias: al abrirlo faltaban pines.
 * Ahora las páginas se piden seguidas, con reintentos, y el resultado queda
 * listo (y compartido) para cuando se abra el mapa.
 */
const PAGE_SIZE = 30;
const MAX_EVENTS = 400;
const PAGE_TIMEOUT_MS = 12_000;
const RETRIES = 3;
/** Pasado este rato se recarga al abrir el mapa (sin vaciar lo que ya hay). */
const FRESH_MS = 5 * 60_000;

type Listener = () => void;

let events: ExternalEvent[] = [];
let social: Record<string, EventSocialSummary> = {};
let loadedAt = 0;
let running: Promise<void> | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPageWithRetry(cursor: EventCursor | null): Promise<ExternalEvent[] | null> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PAGE_TIMEOUT_MS);
    try {
      return await fetchEventPage({}, cursor, abort.signal);
    } catch {
      await sleep(700 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchSocial(ids: string[]): Promise<Record<string, EventSocialSummary>> {
  const out: Record<string, EventSocialSummary> = {};
  for (let i = 0; i < ids.length; i += 100) {
    try {
      Object.assign(out, await fetchEventSocialSummaries(ids.slice(i, i + 100)));
    } catch {
      /* sin contadores para este bloque: los pines salen igual */
    }
  }
  return out;
}

export function peekMapEvents(): { events: ExternalEvent[]; social: Record<string, EventSocialSummary> } {
  return { events, social };
}

export function subscribeMapEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Carga (o refresca) todos los eventos del mapa. Llamadas simultáneas comparten la carga. */
export function preloadMapEvents(force = false): Promise<void> {
  if (running) return running;
  if (!force && events.length > 0 && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();
  running = (async () => {
    const collected: ExternalEvent[] = [];
    const seen = new Set<string>();
    let cursor: EventCursor | null = null;
    let complete = false;
    while (collected.length < MAX_EVENTS) {
      const page = await fetchPageWithRetry(cursor);
      if (!page) break;
      for (const event of page) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        if (isPublishableEvent(event)) collected.push(event);
      }
      // Recarga: no se sustituye la lista hasta tener al menos lo que ya había.
      if (collected.length >= events.length || loadedAt === 0) {
        events = collected.slice();
        notify();
      }
      const last = page[page.length - 1];
      if (page.length < PAGE_SIZE || !last) {
        complete = true;
        break;
      }
      cursor = { date: last.start_date, id: last.id };
    }
    if (complete || collected.length > events.length) events = collected;
    if (complete) loadedAt = Date.now();
    notify();
    social = await fetchSocial(events.map((event) => event.id));
    notify();
  })().finally(() => {
    running = null;
  });
  return running;
}
