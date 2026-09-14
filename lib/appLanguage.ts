import type { Lang } from './i18n';
import { getAuthUser } from './auth';
import { supabase } from './supabase';

/** Guarda el idioma de la app en el perfil para redactar push al destinatario. */
export async function persistPreferredLanguage(lang: Lang): Promise<void> {
    try {
        const user = await getAuthUser();
        const uid = user?.id;
        if (!uid) return;
        await supabase.from('perfiles').update({ idioma: lang }).eq('id', uid);
    } catch {
        /* la columna puede no existir hasta aplicar la migración */
    }
}
