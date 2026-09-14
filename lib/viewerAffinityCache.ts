import { affinityPersonFromProfile, type AffinityPerson } from './profileAffinity';
import { calcAge, parseHabitos } from './profileFields';
import { getBadgeStats, EMPTY_BADGE_STATS } from './badgeStats';
import { getMyProfile } from './profileData';

let cachedUserId: string | null = null;
let cachedPerson: AffinityPerson | null = null;
let inflight: Promise<AffinityPerson | null> | null = null;

/** Persona del viewer para el termómetro (cacheada por sesión). */
export async function ensureViewerAffinityPerson(userId: string): Promise<AffinityPerson | null> {
    if (!userId) return null;
    if (cachedUserId === userId && cachedPerson) return cachedPerson;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const [myProfileRes, myBadges] = await Promise.all([
                getMyProfile(),
                getBadgeStats(userId).catch(() => EMPTY_BADGE_STATS),
            ]);
            const mine = myProfileRes.data;
            if (!mine || mine.id !== userId) return cachedPerson;
            const person = affinityPersonFromProfile({
                age: calcAge(mine.fecha_nacimiento),
                tags: mine.ambientes_preferidos?.length ? mine.ambientes_preferidos : mine.etiquetas,
                habitos: parseHabitos(mine.habitos_consumo),
                stats: myBadges,
                badgeStats: myBadges,
            });
            cachedUserId = userId;
            cachedPerson = person;
            return person;
        } catch {
            return cachedPerson;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

export function peekViewerAffinityPerson(userId: string | null | undefined): AffinityPerson | null {
    if (!userId || cachedUserId !== userId) return null;
    return cachedPerson;
}

export function clearViewerAffinityPerson(): void {
    cachedUserId = null;
    cachedPerson = null;
    inflight = null;
}
