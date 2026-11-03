import { Ionicons } from "@expo/vector-icons";
import type { PendingRatingPlan } from "../../lib/ratings";
import type { UserBadge } from "../../lib/badges";
import type { BadgeStats } from "../../lib/badgeStats";
import type { UserStats } from "../../lib/stats";
import type { OrganizerMeta } from "../../lib/organizer";
import type {
  Genero,
  HabitoConsumo,
  ProfilePrivacy,
} from "../../lib/profileFields";

export type QuickAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  route: string;
  color: string;
  bg: string;
  badge?: number;
};

export type ProfileUiSnapshot = {
  userId: string;
  nombre: string;
  nombreUsuario: string | null;
  coverUrl?: string | null;
  aboutMe: string;
  avatarUrl: string | null;
  age: number | null;
  genero: Genero | null;
  habitoBebida: HabitoConsumo;
  habitoTabaco: HabitoConsumo;
  aficiones: string[];
  perfilGustos: Record<string, unknown>;
  privacy: ProfilePrivacy;
  stats: UserStats;
  friendsCount: number;
  friendsNotifCount: number;
  planRequests: number;
  pendingRatings: PendingRatingPlan[];
  badges: UserBadge[];
  badgeStats?: BadgeStats;
  isOrganizer?: boolean;
  organizer?: OrganizerMeta;
  followersCount?: number;
  attendedPlans?: { id: string; titulo: string; imagen_url: string | null; fecha_evento: string | null; nombre_ubicacion: string | null; categoria: string | null }[];
};
