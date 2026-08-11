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
export async function fetchAccountAccess(userId?: string): Promise<AccountAccess> {
    let uid = userId;
    if (!uid) {
        const session = await getAuthSession();
        uid = session?.user?.id;
    }
    if (!uid) return DEFAULT_ACCESS;

    const { data, error } = await supabase
        .from('perfiles')
        .select('rol, baneado, baneado_motivo')
        .eq('id', uid)
        .maybeSingle();

    if (error) {
        console.warn('fetchAccountAccess:', error.message);
        return UNVERIFIED_ACCESS;
    }
    if (!data) {
        console.warn('fetchAccountAccess: perfil no encontrado');
        return UNVERIFIED_ACCESS;
    }
    return mapAccess(data);
}

export function isStaffRole(role: UserRole | null | undefined): boolean {
    return role === 'owner' || role === 'admin';
}
