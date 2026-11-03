import { supabase } from './supabase';

export type ChampionVoteTotal = { equipo: number; votos: number };

export type ChampionPollSnapshot = {
    myVote: number | null;
    total: number;
    totals: ChampionVoteTotal[];
};

function parseSnap(data: unknown): ChampionPollSnapshot {
    if (!data || typeof data !== 'object') {
        return { myVote: null, total: 0, totals: [] };
    }
    const raw = data as {
        myVote?: unknown;
        total?: unknown;
        totals?: unknown;
        ok?: unknown;
        error?: unknown;
    };
    const my =
        typeof raw.myVote === 'number' && Number.isFinite(raw.myVote)
            ? Math.floor(raw.myVote)
            : null;
    const total =
        typeof raw.total === 'number' && Number.isFinite(raw.total)
            ? Math.max(0, Math.floor(raw.total))
            : 0;
    const totals = Array.isArray(raw.totals)
        ? raw.totals
              .map((row) => {
                  if (!row || typeof row !== 'object') return null;
                  const r = row as { equipo?: unknown; votos?: unknown };
                  if (typeof r.equipo !== 'number' || typeof r.votos !== 'number') return null;
                  return { equipo: Math.floor(r.equipo), votos: Math.max(0, Math.floor(r.votos)) };
              })
              .filter((x): x is ChampionVoteTotal => !!x)
        : [];
    return { myVote: my, total, totals };
}

export async function fetchChampionPoll(planId: string): Promise<ChampionPollSnapshot> {
    const { data, error } = await supabase.rpc('get_torneo_votos_campeon', {
        p_plan_id: planId,
    });
    if (error) return { myVote: null, total: 0, totals: [] };
    return parseSnap(data);
}

export async function voteChampionPoll(
    planId: string,
    equipo: number,
): Promise<ChampionPollSnapshot> {
    const { data, error } = await supabase.rpc('vote_torneo_campeon', {
        p_plan_id: planId,
        p_equipo: equipo,
    });
    if (error) throw new Error(error.message);
    const snap = parseSnap(data);
    if ((data as { ok?: boolean; error?: string } | null)?.ok === false) {
        throw new Error((data as { error?: string }).error || 'vote_failed');
    }
    return snap;
}

export function percentForTeam(snap: ChampionPollSnapshot, equipo: number): number {
    if (snap.total <= 0) return 0;
    const row = snap.totals.find((t) => t.equipo === equipo);
    const votos = row?.votos ?? 0;
    return Math.round((votos / snap.total) * 100);
}
