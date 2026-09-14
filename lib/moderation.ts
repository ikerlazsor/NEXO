import { supabase } from './supabase';

export type TicketEstado = 'abierto' | 'en_revision' | 'resuelto' | 'descartado';
export type SupportTipo = 'contacto' | 'problema' | 'idea' | 'denuncia_general';
export type ReportKind = 'plan' | 'user' | 'message';

export type ModerationCounts = {
    soporte: number;
    reportes_planes: number;
    reportes_usuarios: number;
    reportes_mensajes: number;
    organizadores: number;
    total: number;
};

export type SupportTicket = {
    id: string;
    usuario_id: string;
    tipo: SupportTipo;
    asunto: string | null;
    mensaje: string;
    estado: TicketEstado;
    notas_internas: string | null;
    creado_en: string;
    actualizado_en: string;
    revisado_en: string | null;
    perfil?: { nombre: string | null; nombre_usuario: string | null; avatar_url: string | null } | null;
};

export type PlanReportRow = {
    id: string;
    plan_id: string | null;
    reportador_id: string;
    motivo: string;
    mensaje: string | null;
    estado: TicketEstado;
    notas_internas: string | null;
    creado_en: string;
    revisado_en: string | null;
    plan_titulo?: string | null;
    plan_eliminado?: boolean | null;
    plan_eliminado_en?: string | null;
    plan?: { id: string; titulo: string | null; creador_id: string | null } | null;
    reportador?: { nombre: string | null; nombre_usuario: string | null } | null;
};

export type UserReportRow = {
    id: string;
    denunciado_id: string;
    reportador_id: string;
    motivo: string;
    mensaje: string | null;
    estado: TicketEstado;
    notas_internas: string | null;
    creado_en: string;
    revisado_en: string | null;
    denunciado?: { nombre: string | null; nombre_usuario: string | null; baneado?: boolean | null } | null;
    reportador?: { nombre: string | null; nombre_usuario: string | null } | null;
};

export type MessageReportRow = {
    id: string;
    mensaje_id: string | null;
    reportador_id: string;
    denunciado_id: string | null;
    motivo: string;
    mensaje: string | null;
    contenido_snapshot: string;
    tipo_snapshot: string;
    archivo_url_snapshot: string | null;
    denunciado_nombre_snapshot: string | null;
    denunciado_usuario_snapshot: string | null;
    estado: TicketEstado;
    notas_internas: string | null;
    creado_en: string;
    revisado_en: string | null;
    reportador?: { nombre: string | null; nombre_usuario: string | null } | null;
};

function rpcErr(error: { message?: string } | null): string | null {
    if (!error?.message) return null;
    const m = error.message;
    if (/not_authorized/i.test(m)) return 'not_authorized';
    if (/cannot_moderate_staff/i.test(m)) return 'cannot_moderate_staff';
    if (/user_not_found/i.test(m)) return 'user_not_found';
    if (/plan_not_found/i.test(m)) return 'plan_not_found';
    if (/invalid_target/i.test(m)) return 'invalid_target';
    if (/account_banned/i.test(m)) return 'account_banned';
    return m;
}

/** Extrae el `{ error }` real de una Edge Function (supabase-js solo dice non-2xx). */
async function edgeInvokeError(
    error: unknown,
    data: unknown,
): Promise<string | null> {
    if (data && typeof data === 'object' && data !== null && 'error' in data) {
        const code = (data as { error?: unknown }).error;
        if (typeof code === 'string' && code.trim()) return rpcErr({ message: code }) ?? code;
    }
    const ctx = error && typeof error === 'object' && error !== null && 'context' in error
        ? (error as { context?: Response }).context
        : null;
    if (ctx && typeof ctx.json === 'function') {
        try {
            const body = await ctx.json();
            if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
                const code = (body as { error: string }).error;
                return rpcErr({ message: code }) ?? code;
            }
        } catch {
            /* ignore */
        }
    }
    if (error instanceof Error && error.message) return rpcErr(error) ?? error.message;
    return 'request_failed';
}

export async function fetchModerationCounts(): Promise<ModerationCounts> {
    const empty: ModerationCounts = {
        soporte: 0,
        reportes_planes: 0,
        reportes_usuarios: 0,
        reportes_mensajes: 0,
        organizadores: 0,
        total: 0,
    };
    const { data, error } = await supabase.rpc('admin_moderation_counts');
    if (error) {
        console.warn('fetchModerationCounts:', error.message);
        return empty;
    }
    const row = (data ?? {}) as Partial<ModerationCounts>;
    return {
        soporte: Number(row.soporte ?? 0),
        reportes_planes: Number(row.reportes_planes ?? 0),
        reportes_usuarios: Number(row.reportes_usuarios ?? 0),
        reportes_mensajes: Number(row.reportes_mensajes ?? 0),
        organizadores: Number(row.organizadores ?? 0),
        total: Number(row.total ?? 0),
    };
}

export async function fetchSupportTickets(estado?: TicketEstado | 'pendientes'): Promise<SupportTicket[]> {
    let q = supabase
        .from('mensajes_soporte')
        .select(
            'id, usuario_id, tipo, asunto, mensaje, estado, notas_internas, creado_en, actualizado_en, revisado_en, perfil:perfiles!usuario_id(nombre, nombre_usuario, avatar_url)',
        )
        .order('creado_en', { ascending: false })
        .limit(100);

    if (estado === 'pendientes') {
        q = q.in('estado', ['abierto', 'en_revision']);
    } else if (estado) {
        q = q.eq('estado', estado);
    }

    const { data, error } = await q;
    if (error) {
        console.warn('fetchSupportTickets:', error.message);
        return [];
    }
    return (data ?? []).map((row) => ({
        ...row,
        perfil: Array.isArray(row.perfil) ? row.perfil[0] : row.perfil,
    })) as SupportTicket[];
}

export async function fetchPlanReports(estado?: TicketEstado | 'pendientes'): Promise<PlanReportRow[]> {
    let q = supabase
        .from('reportes_planes')
        .select(
            'id, plan_id, reportador_id, motivo, mensaje, estado, notas_internas, creado_en, revisado_en, plan_titulo, plan_eliminado, plan_eliminado_en, plan:planes!plan_id(id, titulo, creador_id), reportador:perfiles!reportador_id(nombre, nombre_usuario)',
        )
        .order('creado_en', { ascending: false })
        .limit(100);

    if (estado === 'pendientes') {
        q = q.in('estado', ['abierto', 'en_revision']);
    } else if (estado) {
        q = q.eq('estado', estado);
    }

    const { data, error } = await q;
    if (error) {
        console.warn('fetchPlanReports:', error.message);
        // Fallback sin joins si los FK names no coinciden
        const simple = await supabase
            .from('reportes_planes')
            .select(
                'id, plan_id, reportador_id, motivo, mensaje, estado, notas_internas, creado_en, revisado_en, plan_titulo, plan_eliminado, plan_eliminado_en',
            )
            .order('creado_en', { ascending: false })
            .limit(100);
        return (simple.data ?? []) as PlanReportRow[];
    }
    return (data ?? []).map((row) => ({
        ...row,
        plan: Array.isArray(row.plan) ? row.plan[0] : row.plan,
        reportador: Array.isArray(row.reportador) ? row.reportador[0] : row.reportador,
    })) as PlanReportRow[];
}

export async function fetchUserReports(estado?: TicketEstado | 'pendientes'): Promise<UserReportRow[]> {
    let q = supabase
        .from('reportes_usuarios')
        .select(
            'id, denunciado_id, reportador_id, motivo, mensaje, estado, notas_internas, creado_en, revisado_en, denunciado:perfiles!denunciado_id(nombre, nombre_usuario), reportador:perfiles!reportador_id(nombre, nombre_usuario)',
        )
        .order('creado_en', { ascending: false })
        .limit(100);

    if (estado === 'pendientes') {
        q = q.in('estado', ['abierto', 'en_revision']);
    } else if (estado) {
        q = q.eq('estado', estado);
    }

    const { data, error } = await q;
    if (error) {
        console.warn('fetchUserReports:', error.message);
        const simple = await supabase
            .from('reportes_usuarios')
            .select('id, denunciado_id, reportador_id, motivo, mensaje, estado, notas_internas, creado_en, revisado_en')
            .order('creado_en', { ascending: false })
            .limit(100);
        return (simple.data ?? []) as UserReportRow[];
    }
    return (data ?? []).map((row) => ({
        ...row,
        denunciado: Array.isArray(row.denunciado) ? row.denunciado[0] : row.denunciado,
        reportador: Array.isArray(row.reportador) ? row.reportador[0] : row.reportador,
    })) as UserReportRow[];
}

export async function fetchMessageReports(
    estado?: TicketEstado | 'pendientes',
): Promise<MessageReportRow[]> {
    let query = supabase
        .from('reportes_mensajes')
        .select(
            'id, mensaje_id, reportador_id, denunciado_id, motivo, mensaje, contenido_snapshot, tipo_snapshot, archivo_url_snapshot, denunciado_nombre_snapshot, denunciado_usuario_snapshot, estado, notas_internas, creado_en, revisado_en, reportador:perfiles!reportador_id(nombre, nombre_usuario)',
        )
        .order('creado_en', { ascending: false })
        .limit(100);

    if (estado === 'pendientes') query = query.in('estado', ['abierto', 'en_revision']);
    else if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) {
        console.warn('fetchMessageReports:', error.message);
        return [];
    }
    return (data ?? []).map((row) => ({
        ...row,
        reportador: Array.isArray(row.reportador) ? row.reportador[0] : row.reportador,
    })) as MessageReportRow[];
}

export async function setTicketEstado(
    ticketId: string,
    estado: TicketEstado,
    notas?: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('admin_set_ticket_estado', {
        ticket_id: ticketId,
        nuevo_estado: estado,
        notas: notas ?? null,
    });
    return { error: rpcErr(error) };
}

export async function setReportEstado(
    kind: ReportKind,
    reportId: string,
    estado: TicketEstado,
    notas?: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('admin_set_report_estado', {
        report_kind: kind,
        report_id: reportId,
        nuevo_estado: estado,
        notas: notas ?? null,
    });
    return { error: rpcErr(error) };
}

export async function banUser(
    userId: string,
    motivo?: string,
    banned = true,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('admin_ban_user', {
        target_id: userId,
        motivo: motivo ?? null,
        banned,
    });
    return { error: rpcErr(error) };
}

export async function deleteUserAdmin(userId: string): Promise<{ error: string | null }> {
    try {
        const { data, error } = await supabase.functions.invoke('delete-account', {
            body: { targetUserId: userId },
        });
        if (error) return { error: await edgeInvokeError(error, data) };
        const payload = data as { error?: string } | null;
        return { error: payload?.error ? (rpcErr({ message: payload.error }) ?? payload.error) : null };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'delete_user_failed' };
    }
}

export async function deletePlanAdmin(planId: string): Promise<{ error: string | null }> {
    try {
        const { data, error } = await supabase.functions.invoke('delete-plan', {
            body: { planId },
        });
        if (error) return { error: await edgeInvokeError(error, data) };
        const payload = data as { error?: string } | null;
        return { error: payload?.error ? (rpcErr({ message: payload.error }) ?? payload.error) : null };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'delete_plan_failed' };
    }
}

export type InboxItemKind = 'soporte' | 'plan' | 'user' | 'message';

/** Elimina un elemento de la bandeja de moderación (limpieza). */
export async function deleteInboxItem(
    kind: InboxItemKind,
    itemId: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('admin_delete_inbox_item', {
        item_kind: kind,
        item_id: itemId,
    });
    return { error: rpcErr(error) };
}

export function planReportTitle(row: PlanReportRow): string {
    if (row.plan?.titulo) return row.plan.titulo;
    if (row.plan_titulo) return row.plan_titulo;
    if (row.plan_id) return row.plan_id.slice(0, 8);
    return 'Plan';
}
