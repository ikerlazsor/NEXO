import { getAuthSession } from './auth';
import { readNombreFromUser } from './profile';
import { getMyProfile } from './profileData';
import { supabase } from './supabase';
import type { Genero } from './profileFields';

export type OnboardingData = {
    /** YYYY-MM-DD */
    fecha_nacimiento: string;
    genero: Genero;
    avatar_url: string;
    ambientes_preferidos: string[];
    descripcion?: string;
    nombre?: string;
};

export async function fetchOnboardingStatus(
    userId: string,
    options: { signal?: AbortSignal; throwOnError?: boolean } = {},
): Promise<boolean | null> {
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (options.signal?.aborted) {
            const abortError = new Error('Onboarding request aborted');
            abortError.name = 'AbortError';
            throw abortError;
        }
        const session = await getAuthSession();
        // Sesión a medias (cambio de red, refresh): no sabemos si el registro está hecho.
        if (session?.user.id !== userId) return null;
        const { data, error } = await getMyProfile();

        if (error) {
            if (options.signal?.aborted) {
                const abortError = new Error('Onboarding request aborted');
                abortError.name = 'AbortError';
                throw abortError;
            }
            console.warn('fetchOnboardingStatus:', error.message);
            if (options.throwOnError) throw new Error(error.message);
            return null;
        }

        if (!data) {
            if (attempt < maxAttempts - 1) {
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(resolve, 180);
                    options.signal?.addEventListener(
                        'abort',
                        () => {
                            clearTimeout(timer);
                            const abortError = new Error('Onboarding request aborted');
                            abortError.name = 'AbortError';
                            reject(abortError);
                        },
                        { once: true },
                    );
                });
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
    _metadata?: Record<string, unknown> | null
): Promise<boolean | null> {
    // user_metadata lo puede escribir el cliente: solo cuenta la fila en perfiles.
    // null = no se pudo leer (red); no equivale a "registro sin terminar".
    return fetchOnboardingStatus(userId);
}

export async function saveOnboardingPreferences(
    userId: string,
    data: OnboardingData
): Promise<{ error: string | null }> {
    const session = await getAuthSession();
    const nombre =
        (data.nombre && data.nombre.trim()) ||
        readNombreFromUser(session?.user ?? {});

    const preferencePayload: Record<string, unknown> = {
        fecha_nacimiento: data.fecha_nacimiento,
        genero: data.genero,
        avatar_url: data.avatar_url,
        ambientes_preferidos: data.ambientes_preferidos,
        etiquetas: data.ambientes_preferidos,
        descripcion: data.descripcion?.trim() || null,
        registro_completado: true,
    };
    if (nombre) preferencePayload.nombre = nombre;

    const saved = await persistOnboardingProfile(userId, preferencePayload);
    if (saved.error) return saved;

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

function isDuplicateProfile(message: string): boolean {
    return /duplicate key|23505|already exists|perfiles_pkey/i.test(message);
}

function wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * El update puede haber quedado escrito y la lectura siguiente fallar (red justo
 * al terminar). Insertar entonces choca con la fila que ya existe y la pantalla
 * enseña error aunque el perfil esté guardado. Aquí se relee y, si la fila ya
 * estaba, se da por bueno.
 */
async function persistOnboardingProfile(
    userId: string,
    payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
    const { error } = await supabase.from('perfiles').update(payload).eq('id', userId);
    if (error) return { error: error.message };

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, error: readError } = await getMyProfile();
        if (data?.registro_completado) return { error: null };

        if (readError) {
            await wait(280);
            continue;
        }

        if (!data) {
            const { error: insertError } = await supabase
                .from('perfiles')
                .insert({ id: userId, ...payload });
            if (insertError && !isDuplicateProfile(insertError.message)) {
                return { error: insertError.message };
            }
            await wait(220);
            continue;
        }

        if (attempt === 0) {
            const { error: again } = await supabase.from('perfiles').update(payload).eq('id', userId);
            if (again) return { error: again.message };
        }
        await wait(280);
    }

    const { data } = await getMyProfile();
    if (data?.registro_completado) return { error: null };
    return { error: 'No se pudo guardar el perfil.' };
}
