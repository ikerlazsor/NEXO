import type { Membership } from '../components/PlanCard';
import type { FeedTaste } from './feedAffinity';
import type { Genero } from './profileFields';
import { screenCacheKey, ScreenCacheTTL } from './screenCaches';

export const FEED_CACHE_KEY = screenCacheKey.feedSnapshot;
export const FEED_CACHE_TTL_MS = ScreenCacheTTL.feedSnapshot;

export type FeedSnapshot = {
    plans: any[];
    membershipMap: Record<string, Membership>;
    savedPlans: string[];
    currentUserId: string | null;
    currentUserGenero: Genero | null;
    friendIds: string[];
    coincidedIds: string[];
    invitedPlanIds: string[];
    feedTaste: FeedTaste;
    notifBreakdown: { friendRequests: number; planRequests: number; planInvites: number };
};

export const FEED_PLAN_COLUMNS =
    'id, titulo, imagen_url, categoria, tipo_deporte, solo_chicas, solo_amigos, modo_privado, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, estado';
