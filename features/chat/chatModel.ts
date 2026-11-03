import { isLegacyPlanCreatedNotice } from "../../lib/chatSystem";

export const PAGE_SIZE = 50;
export const PLAN_CHAT_TTL_MS = 15 * 60 * 1000;
export const DIRECT_CHAT_TTL_MS = 15 * 60 * 1000;
export const planChatKey = (planId: string) => `planChat:${planId}`;
export const directChatKey = (a: string, b: string) => {
  const [x, y] = [a, b].sort();
  return `directChat:${x}:${y}`;
};

export interface MessageProfile {
  nombre: string;
  avatar_url: string | null;
}

export interface Message {
  id: string;
  contenido: string;
  emisor_id: string;
  creado_en: string;
  tipo: "texto" | "imagen" | "video" | "audio";
  archivo_url: string | null;
  perfiles: MessageProfile | MessageProfile[] | null;
  pending?: boolean;
  /** Soft-delete: el contenido ya no se muestra. */
  eliminado_en?: string | null;
  /** Key estable de lista: no cambia al pasar de local-* al id del servidor. */
  clientKey?: string;
}

export function normalizeProfile(
  perfiles: Message["perfiles"],
): MessageProfile | null {
  if (!perfiles) return null;
  if (Array.isArray(perfiles)) return perfiles[0] ?? null;
  return perfiles;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function parseStoredDuration(contenido: string): number | null {
  if (!contenido || !/^\d+$/.test(contenido.trim())) return null;
  const value = parseInt(contenido, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function mapMessageRow(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    contenido: (row.contenido as string) ?? "",
    emisor_id: row.emisor_id as string,
    creado_en: row.creado_en as string,
    tipo: (row.tipo as Message["tipo"]) ?? "texto",
    archivo_url: (row.archivo_url as string | null) ?? null,
    perfiles: row.perfiles as Message["perfiles"],
    eliminado_en: (row.eliminado_en as string | null) ?? null,
  };
}

export const CHAT_MEMORY_CAP = 400;

export function pickPerfiles(
  a: Message["perfiles"] | null | undefined,
  b: Message["perfiles"] | null | undefined,
): Message["perfiles"] | null {
  const na = normalizeProfile(a ?? null);
  const nb = normalizeProfile(b ?? null);
  const score = (p: MessageProfile | null) => {
    if (!p) return 0;
    let s = 1;
    if (p.nombre) s += 1;
    if (p.avatar_url) s += 2;
    return s;
  };
  if (score(na) === 0 && score(nb) === 0) return a ?? b ?? null;
  return score(na) >= score(nb) ? (a ?? null) : (b ?? null);
}

export function withFallbackProfile(
  item: Message,
  fallback: MessageProfile | null | undefined,
): Message {
  if (!fallback) return item;
  const picked = pickPerfiles(item.perfiles, fallback);
  if (picked === item.perfiles) return item;
  return { ...item, perfiles: picked };
}

export function chatListKey(item: { id: string; clientKey?: string }): string {
  return item.clientKey || item.id;
}

function isOptimisticId(id: string) {
  return id.startsWith("local-");
}

/**
 * Inserta o sustituye in-place la burbuja local para no remontar la fila
 * (el salto brusco al mandar venía de borrar local-* y crear otro id).
 */
export function reconcileIncomingChatMessage(
  prev: Message[],
  incoming: Message,
  isSameOptimistic: (local: Message) => boolean,
): { next: Message[]; kind: "dup" | "replace" | "insert" } {
  if (prev.some((m) => m.id === incoming.id)) {
    let changed = false;
    const next = prev.map((m) => {
      if (m.id !== incoming.id) return m;
      const perfiles = pickPerfiles(incoming.perfiles, m.perfiles);
      if (perfiles === m.perfiles) return m;
      changed = true;
      return { ...m, perfiles };
    });
    return { next: changed ? next : prev, kind: "dup" };
  }
  const idx = prev.findIndex(
    (m) => isOptimisticId(m.id) && isSameOptimistic(m),
  );
  if (idx >= 0) {
    const next = prev.slice();
    const local = prev[idx];
    next[idx] = {
      ...incoming,
      clientKey: local.clientKey ?? local.id,
      pending: false,
      perfiles: pickPerfiles(incoming.perfiles, local.perfiles),
    };
    return { next, kind: "replace" };
  }
  return { next: [incoming, ...prev], kind: "insert" };
}

export function mergeMessages(a: Message[], b: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const m of [...a, ...b]) {
    if (m.tipo === "texto" && isLegacyPlanCreatedNotice(m.contenido)) continue;
    const prev = map.get(m.id);
    map.set(
      m.id,
      prev
        ? {
            ...m,
            clientKey: m.clientKey ?? prev.clientKey,
            pending: m.pending ?? prev.pending,
            perfiles: pickPerfiles(m.perfiles, prev.perfiles),
          }
        : m,
    );
  }
  let merged = Array.from(map.values());
  const server = merged.filter((m) => !isOptimisticId(m.id));
  const locals = merged.filter((m) => isOptimisticId(m.id));
  if (locals.length) {
    const claimed = new Set<string>();
    const keptLocals: Message[] = [];
    for (const loc of locals) {
      const twin = server.find(
        (s) =>
          !claimed.has(s.id) &&
          s.emisor_id === loc.emisor_id &&
          s.tipo === loc.tipo &&
          s.contenido === loc.contenido,
      );
      if (twin) {
        claimed.add(twin.id);
        twin.clientKey = twin.clientKey ?? loc.clientKey ?? loc.id;
        twin.perfiles = pickPerfiles(twin.perfiles, loc.perfiles);
        continue;
      }
      keptLocals.push(loc);
    }
    merged = [...server, ...keptLocals];
  }
  merged.sort((x, y) => {
    const ty = new Date(y.creado_en).getTime();
    const tx = new Date(x.creado_en).getTime();
    return (Number.isFinite(ty) ? ty : 0) - (Number.isFinite(tx) ? tx : 0);
  });
  return merged.length > CHAT_MEMORY_CAP ? merged.slice(0, CHAT_MEMORY_CAP) : merged;
}

export type PlanChatSnapshot = {
  messages: Message[];
  planName: string;
  planImage: string | null;
  participantNames: string;
  isGroupChat: boolean;
  planCategory: string | null;
  planOwnerId: string | null;
  members: {
    id: string;
    nombre: string;
    avatar_url: string | null;
    isCreator: boolean;
    genero?: string | null;
  }[];
  creatorId: string | null;
  planFechaEvento: string | null;
  modoPrivado: boolean;
  accessDenied: boolean;
  hasMore: boolean;
};

export type DirectChatSnapshot = {
  messages: Message[];
  otherUserName: string;
  otherUserAvatar: string | null;
  hasMore: boolean;
};
