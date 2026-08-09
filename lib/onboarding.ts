import { getAuthSession } from './auth';
import { readNombreFromUser } from './profile';
import { supabase } from './supabase';
import type { Genero } from './profileFields';

export type OnboardingData = {
    /** YYYY-MM-DD */
    fecha_nacimiento: string;
    genero: Genero;
    avatar_url: string;
    ambientes_preferidos: string[];
};

export async function fetchOnboardingStatus(userId: string): Promise<boolean> {
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const { data, error } = await supabase
            .from('perfiles')
            .select('registro_completado')
            .eq('id', userId)
            .maybeSingle();

        if (error) {
            console.warn('fetchOnboardingStatus:', error.message);
            return false;
        }

        if (!data) {
            if (attempt < maxAttempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 180));
                continue;
            }
            return false;
        }

        return data.registro_completado === true;
    }

    return false;
}

export async function resolveOnboardingDone(
    userId: string,
    metadata?: Record<string, unknown> | null
): Promise<boolean> {
    const dbDone = await fetchOnboardingStatus(userId);
    if (dbDone) return true;
    if (metadata?.registro_completado === true || metadata?.onboarding_completed === true) return true;
    return false;
}

export async function saveOnboardingPreferences(
    userId: string,
    data: OnboardingData
): Promise<{ error: string | null }> {
    const session = await getAuthSession();
    const nombre = readNombreFromUser(session?.user ?? {});

    const preferencePayload: Record<string, unknown> = {
        fecha_nacimiento: data.fecha_nacimiento,
        genero: data.genero,
        avatar_url: data.avatar_url,
        ambientes_preferidos: data.ambientes_preferidos,
        etiquetas: data.ambientes_preferidos,
        registro_completado: true,
    };
    if (nombre) preferencePayload.nombre = nombre;

    const { data: updated, error } = await supabase
        .from('perfiles')
        .update(preferencePayload)
        .eq('id', userId)
        .select('registro_completado, nombre')
        .maybeSingle();

    if (error) {
        return { error: error.message };
    }

    if (!updated?.registro_completado) {
        const upsertPayload: Record<string, unknown> = {
            id: userId,
            ...preferencePayload,
        };

        const { data: upserted, error: upsertError } = await supabase
            .from('perfiles')
            .upsert(upsertPayload, { onConflict: 'id' })
            .select('registro_completado, nombre')
            .maybeSingle();

        if (upsertError) {
            return { error: upsertError.message };
        }
        if (!upserted?.registro_completado) {
            return { error: 'No se pudo guardar el perfil.' };
        }
    }

    void supabase.auth
        .updateUser({
            data: {
                registro_completado: true,
                onboarding_completed: true,
                ...(nombre ? { nombre } : {}),
            },
        })
        .catch((e) => console.warn('saveOnboardingPreferences updateUser:', e));

    await supabase.auth.refreshSession().catch(() => {});

    try {
        const { trackFunnel } = await import('./analytics');
        trackFunnel('signup_complete', { userId });
        trackFunnel('onboarding_complete', { userId });
    } catch {
        /* ignore */
    }

    return { error: null };
}
