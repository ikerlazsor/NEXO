import { getAuthSession } from './auth';
import { supabase } from './supabase';

export type UserRole = 'user' | 'admin' | 'owner';

export type AccountAccess = {
    role: UserRole;
    banned: boolean;
    banReason: string | null;
    isStaff: boolean;
    isOwner: boolean;
    /** False when the database did not confirm the account state. */
    verified: boolean;
};

const DEFAULT_ACCESS: AccountAccess = {
    role: 'user',
    banned: false,
    banReason: null,
    isStaff: false,
    isOwner: false,
    verified: true,
};

const UNVERIFIED_ACCESS: AccountAccess = {
    ...DEFAULT_ACCESS,
    verified: false,
};

function mapAccess(row: {
    rol?: string | null;
    baneado?: boolean | null;
    baneado_motivo?: string | null;
} | null): AccountAccess {
    const role: UserRole =
        row?.rol === 'owner' || row?.rol === 'admin' ? row.rol : 'user';
    const banned = row?.baneado === true;
    const isOwner = role === 'owner' && !banned;
    const isStaff = (role === 'owner' || role === 'admin') && !banned;
    return {
        role,
        banned,
        banReason: row?.baneado_motivo ?? null,
        isStaff,
        isOwner,
        verified: true,
    };
}

/** Carga rol/ban del usuario autenticado. */
export async function fetchAccountAccess(
    userId?: string,
    options: { signal?: AbortSignal; throwOnError?: boolean } = {},
): Promise<AccountAccess> {
    let uid = userId;
    if (!uid) {
        const session = await getAuthSession();
        uid = session?.user?.id;
    }
    if (!uid) return DEFAULT_ACCESS;

    let query = supabase.rpc('get_my_account_access');
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;

    if (error) {
        if (options.signal?.aborted) {
            const abortError = new Error('Account access request aborted');
            abortError.name = 'AbortError';
            throw abortError;
        }
        console.warn('fetchAccountAccess:', error.message);
        if (options.throwOnError) throw new Error(error.message);
        return { ...UNVERIFIED_ACCESS };
    }
    if (!data) {
        console.warn('fetchAccountAccess: perfil no encontrado');
        return UNVERIFIED_ACCESS;
    }
    return mapAccess(data as {
        rol?: string | null;
        baneado?: boolean | null;
        baneado_motivo?: string | null;
    } | null);
}

export function isStaffRole(role: UserRole | null | undefined): boolean {
    return role === 'owner' || role === 'admin';
}
