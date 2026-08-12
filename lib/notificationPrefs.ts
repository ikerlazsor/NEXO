import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyProfile } from './profileData';
import { supabase } from './supabase';

const KEY = '@nexo_notif_prefs_v1';

export type NotificationCategoryPrefs = {
    messages: boolean;
    social: boolean;
    reminders: boolean;
};

const DEFAULTS: NotificationCategoryPrefs = {
    messages: true,
    social: true,
    reminders: true,
};

let memory: NotificationCategoryPrefs | null = null;

export function resetNotificationCategoryPrefsCache(): void {
    memory = null;
}

export function peekNotificationCategoryPrefs(): NotificationCategoryPrefs {
    return memory ?? { ...DEFAULTS };
}

export async function getNotificationCategoryPrefs(): Promise<NotificationCategoryPrefs> {
    if (memory) return memory;
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<NotificationCategoryPrefs>;
            memory = {
                messages: parsed.messages !== false,
                social: parsed.social !== false,
                reminders: parsed.reminders !== false,
            };
            return memory;
        }
    } catch {
        /* ignore */
    }
    memory = { ...DEFAULTS };
    return memory;
}

export async function setNotificationCategoryPrefs(
    prefs: NotificationCategoryPrefs,
    userId?: string,
): Promise<void> {
    memory = { ...prefs };
    await AsyncStorage.setItem(KEY, JSON.stringify(memory));
    if (userId) {
        await supabase
            .from('perfiles')
            .update({
                notif_messages: prefs.messages,
                notif_social: prefs.social,
                notif_reminders: prefs.reminders,
            })
            .eq('id', userId);
    }
}

/** Carga prefs del servidor (si existen) y las cachea localmente. */
export async function syncNotificationCategoryPrefsFromServer(
    userId: string,
): Promise<NotificationCategoryPrefs> {
    const { data } = await getMyProfile();
    if (data?.id !== userId) return getNotificationCategoryPrefs();
    if (!data) return getNotificationCategoryPrefs();
    const next: NotificationCategoryPrefs = {
        messages: data.notif_messages !== false,
        social: data.notif_social !== false,
        reminders: data.notif_reminders !== false,
    };
    memory = next;
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
}
