import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { getStoredLang, tOffline } from './i18n';
import {
    getNotificationCategoryPrefs,
    syncNotificationCategoryPrefsFromServer,
} from './notificationPrefs';
import {
    getChatExpiryMs,
    getPlanEndMs,
    getRatingsUnlockMs,
    isGroupOrChatPlan,
} from './planLifecycle';
import { withRetry } from './retry';
import { getMyProfile } from './profileData';
import { supabase } from './supabase';

const PREF_KEY = '@nexo_push_enabled';

export const ANDROID_CHANNELS = {
    messages: 'messages',
    social: 'social',
    reminders: 'reminders',
} as const;

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

function projectId(): string | undefined {
    return (
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId ??
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    );
}

export async function getPushPreference(): Promise<boolean> {
    try {
        const local = await AsyncStorage.getItem(PREF_KEY);
        if (local === '0') return false;
        if (local === '1') return true;
    } catch {
        /* ignore */
    }
    return true;
}

/** Preferencia local + servidor. Si el servidor dice false, gana. */
export async function syncPushPreferenceFromServer(userId: string): Promise<boolean> {
    const { data } = await getMyProfile();
    if (data?.id !== userId) return getPushPreference();
    if (data && data.notificaciones_push === false) {
        await AsyncStorage.setItem(PREF_KEY, '0');
        return false;
    }
    if (data && data.notificaciones_push === true) {
        await AsyncStorage.setItem(PREF_KEY, '1');
        return true;
    }
    return getPushPreference();
}

export async function setPushPreference(enabled: boolean, userId?: string): Promise<void> {
    await AsyncStorage.setItem(PREF_KEY, enabled ? '1' : '0');
    if (userId) {
        await supabase.from('perfiles').update({ notificaciones_push: enabled }).eq('id', userId);
    }
    if (enabled) {
        await registerPushToken(userId);
    } else {
        await unregisterPushToken(userId);
        await cancelAllScheduledNexoNotifications();
    }
}

export async function getNotificationPermissionStatus(): Promise<
    'granted' | 'denied' | 'undetermined'
> {
    if (Platform.OS === 'web') return 'granted';
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
}

export async function openSystemNotificationSettings(): Promise<void> {
    try {
        await Linking.openSettings();
    } catch {
        /* ignore */
    }
}

/** Activa push: pide permiso OS si hace falta. Devuelve false si el usuario lo deniega. */
export async function enablePushWithPermission(userId?: string): Promise<{
    enabled: boolean;
    denied: boolean;
}> {
    if (Platform.OS === 'web') {
        await setPushPreference(true, userId);
        return { enabled: true, denied: false };
    }
    await ensureAndroidChannels();
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }
    if (finalStatus !== 'granted') {
        await AsyncStorage.setItem(PREF_KEY, '0');
        if (userId) {
            await supabase.from('perfiles').update({ notificaciones_push: false }).eq('id', userId);
        }
        return { enabled: false, denied: true };
    }
    await setPushPreference(true, userId);
    return { enabled: true, denied: false };
}

async function ensureAndroidChannels() {
    if (Platform.OS !== 'android') return;
    await Promise.all([
        Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.messages, {
            name: 'Mensajes',
            description: 'Chats de planes y mensajes directos',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 220, 120, 220],
            lightColor: '#4DA6FF',
            sound: 'default',
        }),
        Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.social, {
            name: 'Social',
            description: 'Amistades, uniones e invitaciones',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 180],
            lightColor: '#4DA6FF',
            sound: 'default',
        }),
        Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.reminders, {
            name: 'Recordatorios',
            description: 'Planes de hoy, valoraciones y caducidad de chat',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 150, 250],
            lightColor: '#4DA6FF',
            sound: 'default',
        }),
    ]);
}

/** @deprecated use ensureAndroidChannels — kept for callers that used the old single channel */
async function ensureAndroidChannel() {
    await ensureAndroidChannels();
}

/** Registra el token Expo Push y lo guarda en Supabase. */
export async function registerPushToken(userId?: string): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    if (!Device.isDevice) return null;

    const enabled = await getPushPreference();
    if (!enabled) return null;

    await ensureAndroidChannels();

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const pid = projectId();
    if (!pid) {
        console.warn('[push] Falta EAS projectId (app.json extra.eas.projectId o EXPO_PUBLIC_EAS_PROJECT_ID)');
        return null;
    }

    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    const token = tokenRes.data;
    if (!token) return null;

    let uid = userId;
    if (!uid) {
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id;
    }
    if (!uid) return token;

    await supabase.from('push_tokens').upsert(
        {
            user_id: uid,
            token,
            platform: Platform.OS,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' },
    );

    await supabase.from('perfiles').update({ notificaciones_push: true }).eq('id', uid);
    void syncNotificationCategoryPrefsFromServer(uid);

    return token;
}

export async function unregisterPushToken(userId?: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        let uid = userId;
        if (!uid) {
            const { data } = await supabase.auth.getUser();
            uid = data.user?.id;
        }
        if (!uid) return;

        const pid = projectId();
        if (pid) {
            try {
                const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId: pid });
                const token = tokenRes.data;
                if (token) {
                    await supabase.from('push_tokens').delete().eq('user_id', uid).eq('token', token);
                    return;
                }
            } catch {
                /* fall through to delete all for user */
            }
        }
        await supabase.from('push_tokens').delete().eq('user_id', uid);
    } catch {
        /* ignore */
    }
}

export type PushNotifyType =
    | 'friend_request'
    | 'friend_accepted'
    | 'plan_join_request'
    | 'plan_joined'
    | 'plan_join_accepted'
    | 'plan_join_rejected'
    | 'plan_invite'
    | 'plan_message'
    | 'direct_message'
    | 'rated';

/** Dispara la Edge Function send-push (fire-and-forget, 1 reintento). */
export function notifyPush(payload: Record<string, unknown> & { type: PushNotifyType }): void {
    void withRetry(
        async () => {
            const { error } = await supabase.functions.invoke('send-push', { body: payload });
            if (error) throw error;
        },
        { retries: 1, baseMs: 600 },
    ).catch(() => {});
}

export function notifyFriendRequest(toUserId: string) {
    notifyPush({ type: 'friend_request', toUserId });
}

export function notifyFriendAccepted(toUserId: string) {
    notifyPush({ type: 'friend_accepted', toUserId });
}

export function notifyPlanJoin(planId: string, estado: 'pendiente' | 'aceptado' | 'lista_espera') {
    if (estado === 'lista_espera') return;
    notifyPush({
        type: estado === 'pendiente' ? 'plan_join_request' : 'plan_joined',
        planId,
    });
}

export function notifyPlanJoinDecision(
    planId: string,
    toUserId: string,
    accepted: boolean,
) {
    notifyPush({
        type: accepted ? 'plan_join_accepted' : 'plan_join_rejected',
        planId,
        toUserId,
    });
}

export function notifyPlanInvite(planId: string, toUserId: string) {
    notifyPush({ type: 'plan_invite', planId, toUserId });
}

export function notifyPlanMessage(planId: string, messageId: string) {
    notifyPush({ type: 'plan_message', planId, messageId });
}

export function notifyDirectMessage(toUserId: string, messageId: string) {
    notifyPush({ type: 'direct_message', toUserId, messageId });
}

/** Alguien te ha valorado tras un plan. */
export function notifyRated(toUserId: string, planId: string) {
    notifyPush({ type: 'rated', toUserId, planId });
}

async function scheduleLocalAt(opts: {
    ident: string;
    whenMs: number;
    title: string;
    body: string;
    data: Record<string, string>;
    channelId?: string;
}): Promise<void> {
    if (Platform.OS === 'web') return;
    if (opts.whenMs <= Date.now() + 5_000) return;
    const enabled = await getPushPreference();
    if (!enabled) return;
    const cats = await getNotificationCategoryPrefs();
    if (!cats.reminders) return;
    await ensureAndroidChannel();
    try {
        await Notifications.cancelScheduledNotificationAsync(opts.ident);
    } catch {
        /* may not exist */
    }
    await Notifications.scheduleNotificationAsync({
        identifier: opts.ident,
        content: {
            title: opts.title,
            body: opts.body,
            data: opts.data,
            sound: 'default',
        },
        trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(opts.whenMs),
            channelId: opts.channelId ?? ANDROID_CHANNELS.reminders,
        },
    });
}

export async function cancelPlanLifecycleReminders(planId: string): Promise<void> {
    if (Platform.OS === 'web') return;
    await Promise.all(
        [`rating:${planId}`, `plan-today:${planId}`, `chat-expiry:${planId}`].map((ident) =>
            Notifications.cancelScheduledNotificationAsync(ident).catch(() => {}),
        ),
    );
}

export async function cancelAllScheduledNexoNotifications(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {
        /* ignore */
    }
}

/** Programa recordatorio local cuando se desbloquean valoraciones. */
export async function scheduleRatingReminder(opts: {
    planId: string;
    planTitle: string;
    fechaEvento: string | null | undefined;
    categoria?: string | null;
}): Promise<void> {
    if (isGroupOrChatPlan({ categoria: opts.categoria })) return;
    const unlock = getRatingsUnlockMs(opts.fechaEvento);
    if (unlock == null) return;
    const lang = await getStoredLang();
    const title = tOffline(lang, 'push.ratingTitle');
    const body = tOffline(lang, 'push.ratingBody', {
        title: opts.planTitle || tOffline(lang, 'push.fallbackPlan'),
    });
    await scheduleLocalAt({
        ident: `rating:${opts.planId}`,
        whenMs: unlock,
        title,
        body,
        data: { type: 'rating_ready', screen: 'rate-plan', planId: opts.planId },
        channelId: ANDROID_CHANNELS.reminders,
    });
}

/** Recordatorio el día del plan (mañana a las 9:00 local, o 2h antes si es el mismo día). */
export async function schedulePlanTodayReminder(opts: {
    planId: string;
    planTitle: string;
    fechaEvento: string | null | undefined;
    categoria?: string | null;
    locationName?: string | null;
}): Promise<void> {
    if (isGroupOrChatPlan({ categoria: opts.categoria })) return;
    const end = getPlanEndMs(opts.fechaEvento);
    if (end == null) return;
    const event = new Date(end);
    const morning = new Date(event.getFullYear(), event.getMonth(), event.getDate(), 9, 0, 0);
    let whenMs = morning.getTime();
    if (whenMs >= end - 30 * 60 * 1000) {
        whenMs = end - 2 * 60 * 60 * 1000;
    }
    if (whenMs <= Date.now()) return;
    const lang = await getStoredLang();
    const timeStr = event.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'es-ES', {
        hour: '2-digit',
        minute: '2-digit',
    });
    const place = opts.locationName?.trim();
    const planTitle = opts.planTitle || tOffline(lang, 'push.fallbackPlan');
    const body = place
        ? tOffline(lang, 'push.planTodayBodyPlace', { time: timeStr, place, title: planTitle })
        : tOffline(lang, 'push.planTodayBody', { time: timeStr, title: planTitle });
    await scheduleLocalAt({
        ident: `plan-today:${opts.planId}`,
        whenMs,
        title: tOffline(lang, 'push.planTodayTitle'),
        body,
        data: { type: 'plan_today', screen: 'plan', planId: opts.planId },
        channelId: ANDROID_CHANNELS.reminders,
    });
}

/** Aviso 2h antes de que caduque el chat del plan. */
export async function scheduleChatExpiringReminder(opts: {
    planId: string;
    planTitle: string;
    fechaEvento: string | null | undefined;
    categoria?: string | null;
}): Promise<void> {
    if (isGroupOrChatPlan({ categoria: opts.categoria })) return;
    const expiry = getChatExpiryMs(opts.fechaEvento);
    if (expiry == null) return;
    const whenMs = expiry - 2 * 60 * 60 * 1000;
    if (whenMs <= Date.now()) return;
    const lang = await getStoredLang();
    await scheduleLocalAt({
        ident: `chat-expiry:${opts.planId}`,
        whenMs,
        title: tOffline(lang, 'push.chatExpiryTitle'),
        body: tOffline(lang, 'push.chatExpiryBody', {
            title: opts.planTitle || tOffline(lang, 'push.fallbackPlan'),
        }),
        data: { type: 'chat_expiring', screen: 'chat', planId: opts.planId },
        channelId: ANDROID_CHANNELS.reminders,
    });
}

/** Reprograma recordatorios locales de un plan al unirse / al abrir la app. */
export async function schedulePlanLifecycleReminders(opts: {
    planId: string;
    planTitle: string;
    fechaEvento: string | null | undefined;
    categoria?: string | null;
    locationName?: string | null;
}): Promise<void> {
    await Promise.all([
        scheduleRatingReminder(opts),
        schedulePlanTodayReminder(opts),
        scheduleChatExpiringReminder(opts),
    ]);
}

export type PushNavTarget = { href: string } | null;

export function resolvePushNavigation(data: Record<string, unknown> | undefined): PushNavTarget {
    if (!data) return null;
    const screen = String(data.screen ?? '');
    const type = String(data.type ?? '');
    const planId = data.planId ? String(data.planId) : '';
    const otherUserId = data.otherUserId ? String(data.otherUserId) : '';

    // Invitación: ir al plan (aceptar/rechazar) aunque el payload antiguo diga friends.
    if (type === 'plan_invite' && planId) {
        return { href: `/plan/${planId}` };
    }

    switch (screen) {
        case 'friends':
            return { href: '/friends' };
        case 'my-plans':
            return planId ? { href: `/plan/${planId}` } : { href: '/(tabs)/my-plans' };
        case 'feed':
            return { href: '/(tabs)' };
        case 'plan':
            return planId ? { href: `/plan/${planId}` } : { href: '/(tabs)/my-plans' };
        case 'chat':
            return planId ? { href: `/chat/${planId}` } : { href: '/(tabs)/chats' };
        case 'direct-chat':
            return otherUserId ? { href: `/direct-chat/${otherUserId}` } : null;
        case 'rate-plan':
            return planId ? { href: `/rate-plan?planId=${planId}` } : null;
        case 'profile':
            return { href: '/profile' };
        default:
            if (type === 'rated') return { href: '/profile' };
            if (type === 'plan_today' && planId) return { href: `/plan/${planId}` };
            if (type === 'chat_expiring' && planId) return { href: `/chat/${planId}` };
            if (planId && (type.includes('plan') || type.includes('join'))) {
                return { href: `/plan/${planId}` };
            }
            return null;
    }
}
