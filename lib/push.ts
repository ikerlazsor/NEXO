import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { getStoredLang } from './i18n';
import { localeTag } from './locale';
import { persistPreferredLanguage } from './appLanguage';
import {
    getNotificationCategoryPrefs,
    syncNotificationCategoryPrefsFromServer,
} from './notificationPrefs';
import { buildPushCopy, fallbackPlanTitle, resolveAvatarUrl } from './pushCopy';
import {
    getPlanEndMs,
    getRatingsUnlockMs,
    isGroupOrChatPlan,
} from './planLifecycle';
import { withRetry } from './retry';
import { getMyProfile } from './profileData';
import { getAuthUser } from './auth';
import { supabase } from './supabase';

const PREF_KEY = '@nexo_push_enabled';

let pushPrefMemory: boolean | null = null;

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

/** Valor en memoria (ajustes listos al instante). */
export function peekPushPreference(): boolean {
    return pushPrefMemory ?? true;
}

export async function getPushPreference(): Promise<boolean> {
    try {
        const local = await AsyncStorage.getItem(PREF_KEY);
        if (local === '0') {
            pushPrefMemory = false;
            return false;
        }
        if (local === '1') {
            pushPrefMemory = true;
            return true;
        }
    } catch {
        /* ignore */
    }
    pushPrefMemory = true;
    return true;
}

/** Preferencia local + servidor. Si el servidor dice false, gana. */
export async function syncPushPreferenceFromServer(userId: string): Promise<boolean> {
    const { data } = await getMyProfile();
    if (data?.id !== userId) return getPushPreference();
    if (data && data.notificaciones_push === false) {
        pushPrefMemory = false;
        await AsyncStorage.setItem(PREF_KEY, '0');
        return false;
    }
    if (data && data.notificaciones_push === true) {
        pushPrefMemory = true;
        await AsyncStorage.setItem(PREF_KEY, '1');
        return true;
    }
    return getPushPreference();
}

export async function setPushPreference(enabled: boolean, userId?: string): Promise<void> {
    pushPrefMemory = enabled;
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

/** Primera vez tras onboarding: pide permiso si aún no se ha decidido. No insiste si ya lo denegó. */
export async function bootstrapPushForUser(userId: string): Promise<void> {
    const enabled = await syncPushPreferenceFromServer(userId);
    if (!enabled) return;
    const perm = await getNotificationPermissionStatus();
    if (perm === 'granted') {
        await registerPushToken(userId);
        return;
    }
    if (perm === 'undetermined') {
        await enablePushWithPermission(userId);
    }
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
    if (existing !== 'granted') return null;

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
        const user = await getAuthUser();
        uid = user?.id;
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
    try {
        const lang = await getStoredLang();
        await persistPreferredLanguage(lang);
    } catch {
        /* ignore */
    }
    void syncNotificationCategoryPrefsFromServer(uid);

    return token;
}

export async function unregisterPushToken(userId?: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        let uid = userId;
        if (!uid) {
        const user = await getAuthUser();
        uid = user?.id;
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
    | 'plan_invite'
    | 'plan_message'
    | 'direct_message'
    | 'compliment'
    | 'spark'
    | 'plan_cancelled'
    | 'plan_updated';

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
    if (!accepted) return;
    notifyPush({
        type: 'plan_join_accepted',
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

/** Cumplido anónimo tras destacar a alguien (el servidor oculta tu nombre). */
export function notifyCompliment(opts: { toUserId: string; planId: string; trait?: string }) {
    notifyPush({
        type: 'compliment',
        toUserId: opts.toUserId,
        planId: opts.planId,
        trait: opts.trait ?? '',
    });
}

/** Encaje mutuo: sí se puede mostrar el nombre. */
export function notifySpark(opts: { toUserId: string; planId: string }) {
    notifyPush({
        type: 'spark',
        toUserId: opts.toUserId,
        planId: opts.planId,
    });
}

/** Aviso a integrantes: se canceló el plan (también lo hace delete-plan en servidor). */
export function notifyPlanCancelled(planId: string) {
    notifyPush({ type: 'plan_cancelled', planId });
}

/** Aviso a integrantes: cambió fecha/hora y/o ubicación. */
export function notifyPlanUpdated(opts: {
    planId: string;
    changedDate?: boolean;
    changedPlace?: boolean;
    time?: string;
    place?: string;
}) {
    if (!opts.changedDate && !opts.changedPlace) return;
    notifyPush({
        type: 'plan_updated',
        planId: opts.planId,
        changedDate: !!opts.changedDate,
        changedPlace: !!opts.changedPlace,
        time: opts.time ?? '',
        place: opts.place ?? '',
    });
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
    const planTitle = opts.planTitle || fallbackPlanTitle(lang);
    const copy = buildPushCopy({
        type: 'rating_ready',
        lang,
        planTitle,
        seed: `rating_ready:${opts.planId}`,
    });
    await scheduleLocalAt({
        ident: `rating:${opts.planId}`,
        whenMs: unlock,
        title: copy.title,
        body: copy.body,
        data: {
            type: 'rating_ready',
            screen: 'rate-plan',
            planId: opts.planId,
            avatarUrl: resolveAvatarUrl(null, 'Nexo!'),
        },
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
    const timeStr = event.toLocaleTimeString(localeTag(lang), {
        hour: '2-digit',
        minute: '2-digit',
    });
    const place = opts.locationName?.trim();
    const planTitle = opts.planTitle || fallbackPlanTitle(lang);
    const copy = buildPushCopy({
        type: 'plan_today',
        lang,
        planTitle,
        time: timeStr,
        place,
        seed: `plan_today:${opts.planId}`,
    });
    await scheduleLocalAt({
        ident: `plan-today:${opts.planId}`,
        whenMs,
        title: copy.title,
        body: copy.body,
        data: {
            type: 'plan_today',
            screen: 'plan',
            planId: opts.planId,
            avatarUrl: resolveAvatarUrl(null, 'Nexo!'),
        },
        channelId: ANDROID_CHANNELS.reminders,
    });
}

/** Ya no se avisa de la caducidad del chat; cancela recordatorios viejos. */
export async function scheduleChatExpiringReminder(opts: {
    planId: string;
    planTitle: string;
    fechaEvento: string | null | undefined;
    categoria?: string | null;
}): Promise<void> {
    if (Platform.OS === 'web') return;
    await Notifications.cancelScheduledNotificationAsync(`chat-expiry:${opts.planId}`).catch(() => {});
}

/** Reprograma recordatorios locales de un plan al unirse / al abrir la app. */
export async function schedulePlanLifecycleReminders(opts: {
    planId: string;
    planTitle: string;
    fechaEvento: string | null | undefined;
    categoria?: string | null;
    locationName?: string | null;
}): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(`chat-expiry:${opts.planId}`).catch(() => {});
    await Promise.all([
        scheduleRatingReminder(opts),
        schedulePlanTodayReminder(opts),
    ]);
}

export type PushNavTarget = { href: string } | null;

/** Normaliza payloads de Expo/Android/iOS (aliases snake_case, strings, data anidada). */
export function normalizePushData(
    raw: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    let data: Record<string, unknown> = { ...raw };

    const nested = data.data;
    if (typeof nested === 'string') {
        try {
            const parsed = JSON.parse(nested) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object') data = { ...data, ...parsed };
        } catch {
            /* ignore */
        }
    } else if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        data = { ...data, ...(nested as Record<string, unknown>) };
    }

    const pick = (...keys: string[]) => {
        for (const key of keys) {
            const v = data[key];
            if (v == null || v === '') continue;
            return String(v);
        }
        return '';
    };

    const planId = pick('planId', 'plan_id', 'planid');
    const otherUserId = pick(
        'otherUserId',
        'other_user_id',
        'senderId',
        'sender_id',
        'userId',
        'user_id',
        'inviterId',
        'inviter_id',
    );
    const inviteId = pick('inviteId', 'invite_id');
    const screen = pick('screen');
    const type = pick('type');

    return {
        ...data,
        ...(type ? { type } : {}),
        ...(screen ? { screen } : {}),
        ...(planId ? { planId } : {}),
        ...(otherUserId ? { otherUserId } : {}),
        ...(inviteId ? { inviteId } : {}),
    };
}

function planInviteHref(planId: string, data: Record<string, unknown>): string {
    const inviteId = data.inviteId ? String(data.inviteId) : '';
    const inviterId = data.otherUserId ? String(data.otherUserId) : '';
    const inviterName = data.senderName || data.inviterName ? String(data.senderName ?? data.inviterName) : '';
    const inviterAvatar = data.avatarUrl || data.inviterAvatar
        ? String(data.avatarUrl ?? data.inviterAvatar)
        : '';
    const inviteTipo = data.inviteTipo ? String(data.inviteTipo) : '';
    const q = new URLSearchParams();
    if (inviteId) q.set('inviteId', inviteId);
    if (inviterId) q.set('inviterId', inviterId);
    if (inviterName) q.set('inviterName', inviterName);
    if (inviterAvatar) q.set('inviterAvatar', inviterAvatar);
    if (inviteTipo) q.set('inviteTipo', inviteTipo);
    const qs = q.toString();
    return qs ? `/plan/${planId}?${qs}` : `/plan/${planId}`;
}

/**
 * Destino canónico al tocar una notificación.
 * Prioriza `type` (payloads nuevos/viejos) y luego `screen`.
 */
export function resolvePushNavigation(raw: Record<string, unknown> | undefined): PushNavTarget {
    const data = normalizePushData(raw);
    if (!data) return null;

    const type = String(data.type ?? '');
    const screen = String(data.screen ?? '');
    const planId = data.planId ? String(data.planId) : '';
    const otherUserId = data.otherUserId ? String(data.otherUserId) : '';

    // --- Por tipo (fuente de verdad) ---
    switch (type) {
        case 'friend_request':
            return { href: '/friends?tab=requests' };
        case 'friend_accepted':
            return otherUserId ? { href: `/user-profile/${otherUserId}` } : { href: '/friends' };
        case 'plan_join_request':
            // El creador gestiona solicitudes en el detalle del plan.
            return planId ? { href: `/plan/${planId}` } : { href: '/friends?tab=requests' };
        case 'plan_joined':
        case 'plan_join_accepted':
        case 'plan_updated':
        case 'plan_today':
            return planId ? { href: `/plan/${planId}` } : { href: '/my-plans' };
        case 'plan_invite':
            if (!planId) return { href: '/friends?tab=requests' };
            return { href: planInviteHref(planId, data) };
        case 'plan_message':
        case 'chat_expiring':
            return planId ? { href: `/chat/${planId}` } : { href: '/(tabs)/chats' };
        case 'direct_message':
            return otherUserId ? { href: `/direct-chat/${otherUserId}` } : { href: '/(tabs)/chats' };
        case 'rating_ready':
        case 'rate_plan':
            return planId ? { href: `/rate-plan?planId=${encodeURIComponent(planId)}` } : null;
        case 'compliment':
        case 'rated':
            return { href: '/profile' };
        case 'spark':
            return otherUserId ? { href: `/user-profile/${otherUserId}` } : { href: '/profile' };
        case 'plan_cancelled':
            return { href: '/my-plans' };
        default:
            break;
    }

    // --- Por screen (locales / legacy) ---
    switch (screen) {
        case 'friends':
            return { href: '/friends?tab=requests' };
        case 'my-plans':
            return planId ? { href: `/plan/${planId}` } : { href: '/my-plans' };
        case 'feed':
        case 'home':
            return { href: '/(tabs)' };
        case 'plan':
            return planId ? { href: `/plan/${planId}` } : { href: '/my-plans' };
        case 'chat':
            return planId ? { href: `/chat/${planId}` } : { href: '/(tabs)/chats' };
        case 'chats':
            return { href: '/(tabs)/chats' };
        case 'direct-chat':
            return otherUserId ? { href: `/direct-chat/${otherUserId}` } : { href: '/(tabs)/chats' };
        case 'rate-plan':
        case 'rate':
            return planId ? { href: `/rate-plan?planId=${encodeURIComponent(planId)}` } : null;
        case 'profile':
            return { href: '/profile' };
        case 'user-profile':
            return otherUserId ? { href: `/user-profile/${otherUserId}` } : { href: '/profile' };
        default:
            if (planId && (type.includes('plan') || type.includes('join'))) {
                return { href: `/plan/${planId}` };
            }
            if (otherUserId && (type.includes('friend') || type.includes('message'))) {
                return type.includes('message')
                    ? { href: `/direct-chat/${otherUserId}` }
                    : { href: `/user-profile/${otherUserId}` };
            }
            return null;
    }
}
