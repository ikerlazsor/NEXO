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
  };
}

export function mergeMessages(a: Message[], b: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const m of [...a, ...b]) {
    if (m.tipo === "texto" && isLegacyPlanCreatedNotice(m.contenido)) continue;
    map.set(m.id, m);
  }
  return Array.from(map.values()).sort(
    (x, y) => new Date(y.creado_en).getTime() - new Date(x.creado_en).getTime(),
  );
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
