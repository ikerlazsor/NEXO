import { isFeedPlan } from './feedPlans';
import type { UserCoords } from './location';
import { supabase } from './supabase';

export type GuestPlanCard = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    isCreator?: boolean;
    es_organizador?: boolean;
};

export type GuestPlanRow = Record<string, unknown> & {
    id: string;
    creador_id?: string;
    categoria?: string | null;
    es_organizador?: boolean;
    joinedCount: number;
    participantsList: GuestPlanCard[];
    host?: GuestPlanCard | null;
};

export type GuestPlanDetail = {
    plan: Record<string, unknown>;
    joinedCount: number;
    participants: GuestPlanCard[];
    creator?: GuestPlanCard | null;
};

function asGuestCard(value: unknown): GuestPlanCard | null {
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) return null;
    return {
        id: o.id,
        nombre: typeof o.nombre === 'string' ? o.nombre : null,
        nombre_usuario: typeof o.nombre_usuario === 'string' ? o.nombre_usuario : null,
        avatar_url: typeof o.avatar_url === 'string' ? o.avatar_url : null,
        isCreator: o.isCreator === true,
        es_organizador: o.es_organizador === true,
    };
}

function normalizeGuestPlan(row: GuestPlanRow): GuestPlanRow {
    const host = asGuestCard(row.host)
        ?? row.participantsList?.find((p) => p.isCreator)
        ?? null;
    const es_organizador = row.es_organizador === true || host?.es_organizador === true;
    if (!es_organizador) {
        return { ...row, host, es_organizador: false };
    }
    const attendees = (row.participantsList ?? []).filter(
        (p) => p.id !== row.creador_id && !p.isCreator,
    );
    return {
        ...row,
        host,
        es_organizador: true,
        participantsList: attendees,
        joinedCount: attendees.length,
    };
}

function asArray(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

export async function fetchGuestFeedPlans(_coords?: UserCoords | null): Promise<GuestPlanRow[]> {
    // Global feed for guests: distance is only a client filter (“Cerca”), not a server cut.
    // Coords stay available to callers for labels / nearby chip.
    const { data, error } = await supabase.rpc('get_guest_feed');
    if (error) throw error;
    return asArray(data)
        .filter((row): row is GuestPlanRow => !!row && typeof row === 'object' && 'id' in row)
        .filter((row) => isFeedPlan(row))
        .map((row) => normalizeGuestPlan({
            ...row,
            participantsList: Array.isArray(row.participantsList) ? row.participantsList : [],
            joinedCount: Number(row.joinedCount) || 0,
        }));
}

export async function fetchGuestPlanDetail(planId: string): Promise<GuestPlanDetail | null> {
    const { data, error } = await supabase.rpc('get_guest_plan', { p_plan_id: planId });
    if (error) throw error;
    if (!data || typeof data !== 'object') return null;
    const row = data as GuestPlanDetail & { creator?: unknown };
    if (!row.plan || typeof row.plan !== 'object') return null;
    const plan = row.plan as Record<string, unknown>;
    const participants = Array.isArray(row.participants) ? row.participants : [];
    const creator = asGuestCard(row.creator)
        ?? participants.find((p) => p.isCreator)
        ?? null;
    const organizer = plan.es_organizador === true || creator?.es_organizador === true;
    const attendees = organizer
        ? participants.filter((p) => p.id !== plan.creador_id && !p.isCreator)
        : participants;
    return {
        plan: { ...plan, es_organizador: organizer },
        joinedCount: organizer ? attendees.length : Number(row.joinedCount) || attendees.length,
        participants: attendees,
        creator,
    };
}
