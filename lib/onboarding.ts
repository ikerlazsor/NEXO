import { getAuthSession } from './auth';
import { readNombreFromUser } from './profile';
import { supabase } from './supabase';

export const ONBOARDING_CATEGORIES = [
    'Fiesta',
    'Deporte',
    'Estudio',
    'Tapas',
    'Paseo chill',
    'Festivales',
] as const;

export type OnboardingCategory = (typeof ONBOARDING_CATEGORIES)[number];

export const MOOD_OPTIONS = ['tranqui', 'equilibrado', 'social'] as const;
export type MoodType = (typeof MOOD_OPTIONS)[number];

export type SocialEnergy = 'introvert' | 'ambivert' | 'extrovert';

export const MOOD_TO_SOCIAL: Record<MoodType, SocialEnergy> = {
    tranqui: 'introvert',
    equilibrado: 'ambivert',
    social: 'extrovert',
};

export const AURA_MIN = 300;
export const AURA_MAX = 1000;

export async function waitForOnboardingSaved(userId: string, attempts = 12): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
        if (await fetchOnboardingStatus(userId)) return true;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
}

export type OnboardingData = {
    categories: OnboardingCategory[];
    mood: MoodType | null;
    auraScore: number;
};

export const CATEGORY_IMAGES: Record<OnboardingCategory, string> = {
    Fiesta: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=85',
    Deporte: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=900&auto=format&fit=crop&q=85',
    Estudio: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=900&q=85',
    Tapas: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=900&q=85',
    'Paseo chill': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85',
    Festivales: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=900&q=85',
};

export const MOOD_GRADIENTS: Record<MoodType, [string, string, string]> = {
    tranqui: ['#E8F1FF', '#DCEBFF', '#C8DEFF'],
    equilibrado: ['#DCEBFF', '#4DA6FF', '#2563EB'],
    social: ['#C8DEFF', '#2563EB', '#1D4ED8'],
};

export async function fetchOnboardingStatus(userId: string): Promise<boolean> {
    const maxAttempts = 4;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const { data, error } = await supabase
            .from('perfiles')
            .select('onboarding_completed')
            .eq('id', userId)
            .maybeSingle();

        if (error) {
            console.warn('fetchOnboardingStatus:', error.message);
            return false;
        }

        if (!data) {
            if (attempt < maxAttempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 400));
                continue;
            }
            return false;
        }

        return data.onboarding_completed === true;
    }

    return false;
}

export async function resolveOnboardingDone(
    userId: string,
    metadata?: Record<string, unknown> | null
): Promise<boolean> {
    const dbDone = await fetchOnboardingStatus(userId);
    if (dbDone) return true;
    if (metadata?.onboarding_completed === true) return true;
    return false;
}

export async function saveOnboardingPreferences(
    userId: string,
    data: OnboardingData
): Promise<{ error: string | null }> {
    const socialEnergy = data.mood ? MOOD_TO_SOCIAL[data.mood] : null;

    const session = await getAuthSession();
    const nombre = readNombreFromUser(session?.user ?? {});

    const preferencePayload: Record<string, unknown> = {
        preferred_categories: data.categories,
        preferred_sports: [],
        social_energy: socialEnergy,
        aura_score: data.auraScore,
        taste_profile: {
            mood: data.mood,
            aura_score: data.auraScore,
            social_energy: socialEnergy,
            completed_at: new Date().toISOString(),
        },
        onboarding_completed: true,
    };
    if (nombre) preferencePayload.nombre = nombre;

    const { data: updated, error } = await supabase
        .from('perfiles')
        .update(preferencePayload)
        .eq('id', userId)
        .select('onboarding_completed, nombre')
        .maybeSingle();

    if (error) {
        return { error: error.message };
    }

    if (!updated?.onboarding_completed) {
        const upsertPayload: Record<string, unknown> = {
            id: userId,
            ...preferencePayload,
        };
        if (nombre) upsertPayload.nombre = nombre;

        const { data: upserted, error: upsertError } = await supabase
            .from('perfiles')
            .upsert(upsertPayload, { onConflict: 'id' })
            .select('onboarding_completed, nombre')
            .maybeSingle();

        if (upsertError) {
            return { error: upsertError.message };
        }
        if (!upserted?.onboarding_completed) {
            return {
                error: 'No se pudo guardar el perfil. Ejecuta supabase/onboarding-preferences.sql en Supabase.',
            };
        }
    }

    void supabase.auth
        .updateUser({
            data: {
                onboarding_completed: true,
                aura_score: data.auraScore,
                ...(nombre ? { nombre } : {}),
            },
        })
        .catch((e) => console.warn('saveOnboardingPreferences updateUser:', e));

    return { error: null };
}
