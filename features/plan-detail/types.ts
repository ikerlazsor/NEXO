import type { Membership } from "../../lib/participants";
import type { Genero } from "../../lib/profileFields";
import type { PendingRatingPlan } from "../../lib/ratings";
import type { UserStats } from "../../lib/stats";

export type Participant = {
  id: string;
  nombre: string;
  avatar_url?: string | null;
  isCreator?: boolean;
  ambientes_preferidos?: string[] | null;
  etiquetas?: string[] | null;
  genero?: string | null;
};

export type PlanRow = {
  id: string;
  titulo: string;
  imagen_url: string | null;
  categoria: string;
  tipo_deporte: string | null;
  fecha_evento: string | null;
  nombre_ubicacion: string | null;
  latitud: number | null;
  longitud: number | null;
  maximo_participantes: number;
  creador_id: string;
  requiere_aprobacion: boolean;
  descripcion: string | null;
  solo_chicas?: boolean;
  modo_privado?: boolean;
  chat_eliminado_en?: string | null;
  imagenes_url?: string[] | null;
  recurrencia?: { freq?: string; paused?: boolean } | null;
  es_organizador?: boolean;
};

export type PlanDetailSnapshot = {
  plan: PlanRow;
  participants: Participant[];
  joinedCount: number;
  creator: Participant | null;
  creatorStats: UserStats;
  membership: Membership;
  friendIds: string[];
  coincidedIds: string[];
  isSaved: boolean;
  currentUserGenero: Genero | null;
  openRating: PendingRatingPlan | null;
  currentUserId: string | null;
  organizerFollowers?: number | null;
  /** Compatibilidad precargada desde el feed / seed. */
  fitPct?: number | null;
  /** Semilla incompleta del feed: no salta el fetch real. */
  partial?: boolean;
  /**
   * `participants` trae a todos los unidos, no la muestra de avatares del feed
   * (get_feed_plan_people recorta la lista a 8).
   */
  participantsComplete?: boolean;
};
