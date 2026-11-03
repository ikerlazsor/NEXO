import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import {
    getActiveConversation,
    isActiveDirectChat,
    isActivePlanChat,
} from '../lib/activeConversation';
import { flushChatOutbox } from '../lib/chatOutbox';
import { getMutedPlanChatIds, syncPlanChatMutesFromServer } from '../lib/chatMute';
import { getChatUnreadMap, refreshChatUnreadBadge, subscribeChatUnread } from '../lib/chatUnread';
import { resolveDeepLinkUrl } from '../lib/deepLinks';
import { hapticMedium } from '../lib/haptics';
import { presentInAppToast } from '../lib/inAppToast';
import { getIsOnline, subscribeNetwork } from '../lib/network';
import { isGroupOrChatPlan } from '../lib/planLifecycle';
import { prefetchPlanDetail } from '../lib/planDetailCache';
import { warmTournamentFromLink } from '../lib/tournamentLineupCache';
import {
    getProfileNotificationCount,
    invalidateProfileNotificationCount,
    subscribeProfileNotifications,
} from '../lib/notifications';
import { dismissPushFromPayload } from '../lib/presentedPush';
import {
    getNotificationCategoryPrefs,
    syncNotificationCategoryPrefsFromServer,
} from '../lib/notificationPrefs';
import {
    bootstrapPushForUser,
    claimPushResponse,
    fallbackPushHref,
    navigateAppHref,
    normalizePushData,
    pruneStaleLocalReminders,
    queuePushHref,
    registerPushToken,
    resolvePushNavigation,
    schedulePlanLifecycleReminders,
    syncPushPreferenceFromServer,
    takeQueuedPushHref,
    unregisterPushToken,
    wasPushResponseHandled,
} from '../lib/push';
import { warmPushDestination } from '../lib/pushWarm';
import { getPendingRatingPlans } from '../lib/ratings';
import { screenCacheKey } from '../lib/screenCaches';
import { supabase } from '../lib/supabase';
import { cacheInvalidate } from '../lib/ttlCache';

function clearInviteSideEffects(userId: string) {
    invalidateProfileNotificationCount(userId);
    cacheInvalidate(screenCacheKey.friends(userId));
    void syncAppBadge(userId);
}

async function syncAppBadge(userId: string) {
    try {
        const [unread, notifs, muted] = await Promise.all([
            getChatUnreadMap(userId),
            getProfileNotificationCount(userId),
            getMutedPlanChatIds(),
        ]);
        // Un chat silenciado tampoco debe subir el número del icono.
        const mutedTotal = muted.reduce((sum, planId) => sum + (unread.plans[planId] ?? 0), 0);
        const chats = Math.max(0, unread.total - mutedTotal);
        await Notifications.setBadgeCountAsync(Math.max(0, chats + notifs.total));
    } catch {
        /* ignore */
    }
}

function shouldSuppressForeground(raw: Record<string, unknown> | undefined): boolean {
    const data = normalizePushData(raw);
    if (!data) return false;
    const planId = data.planId ? String(data.planId) : '';
    const otherUserId = data.otherUserId ? String(data.otherUserId) : '';
    const screen = String(data.screen ?? '');
    const type = String(data.type ?? '');

    if (planId && (screen === 'chat' || type === 'plan_message') && isActivePlanChat(planId)) {
        return true;
    }
    if (
        otherUserId &&
        (screen === 'direct-chat' || type === 'direct_message') &&
        isActiveDirectChat(otherUserId)
    ) {
        return true;
    }
    // Fallback: active conversation matches payload
    const active = getActiveConversation();
    if (active?.kind === 'plan' && planId && active.id === planId && type.includes('message')) {
        return true;
    }
    if (active?.kind === 'direct' && otherUserId && active.id === otherUserId) {
        return true;
    }
    return false;
}

/**
 * Token push, deep links, outbox, recordatorios, badge = chats + acciones pendientes.
 * `ready` evita pedir permiso durante onboarding / email no verificado.
 */
export function PushBootstrap({ userId, ready = true }: { userId: string | null; ready?: boolean }) {
    const router = useRouter();
    const handledUrlRef = useRef<string | null>(null);
    const readyRef = useRef(ready);
    readyRef.current = ready;

    useEffect(() => {
        if (Platform.OS === 'web') return;

        Notifications.setNotificationHandler({
            handleNotification: async (notification) => {
                const data = notification.request.content.data as Record<string, unknown> | undefined;
                const planId = data?.planId ? String(data.planId) : '';
                const screen = String(data?.screen ?? '');
                const type = String(data?.type ?? '');

                if (shouldSuppressForeground(data)) {
                    return {
                        shouldShowBanner: false,
                        shouldShowList: false,
                        shouldPlaySound: false,
                        shouldSetBadge: true,
                    };
                }

                if (planId && (screen === 'chat' || type === 'plan_message')) {
                    const muted = await getMutedPlanChatIds();
                    if (muted.includes(planId)) {
                        return {
                            shouldShowBanner: false,
                            shouldShowList: false,
                            shouldPlaySound: false,
                            shouldSetBadge: true,
                        };
                    }
                }

                // Red de seguridad: el push pudo salir antes de guardarse la preferencia.
                if (type) {
                    const cats = await getNotificationCategoryPrefs();
                    const isMessage = type === 'plan_message' || type === 'direct_message';
                    const isReminder = type === 'plan_today' || type === 'plan_rating';
                    const allowed = isMessage
                        ? cats.messages
                        : isReminder
                            ? cats.reminders
                            : cats.social;
                    if (!allowed) {
                        return {
                            shouldShowBanner: false,
                            shouldShowList: false,
                            shouldPlaySound: false,
                            shouldSetBadge: true,
                        };
                    }
                }

                // En primer plano también banner (salvo chat activo / mute arriba).
                return {
                    shouldShowBanner: true,
                    shouldShowList: true,
                    shouldPlaySound: true,
                    shouldSetBadge: true,
                };
            },
        });
    }, []);

    useEffect(() => {
        if (Platform.OS === 'web') return;
        if (!userId) {
            void unregisterPushToken();
            void Notifications.setBadgeCountAsync(0).catch(() => {});
            return;
        }
        if (!ready) return;

        void (async () => {
            const enabled = await syncPushPreferenceFromServer(userId);
            await syncNotificationCategoryPrefsFromServer(userId);
            await syncPlanChatMutesFromServer(userId);
            if (enabled) await bootstrapPushForUser(userId);
            await syncAppBadge(userId);
        })();

        if (getIsOnline()) void flushChatOutbox();
        void pruneStaleLocalReminders(userId);

        const unsubUnread = subscribeChatUnread(() => {
            void syncAppBadge(userId);
        });
        const unsubNotif = subscribeProfileNotifications(() => {
            void syncAppBadge(userId);
        });

        // Solo DMs hacia mí. Los de plan se actualizan al volver a la app / abrir chats.
        const msgChannel = supabase
            .channel(`badge-mensajes-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'mensajes',
                    filter: `receptor_id=eq.${userId}`,
                },
                (payload) => {
                    const row = payload.new as { emisor_id?: string } | null;
                    if (row?.emisor_id && row.emisor_id === userId) return;
                    void refreshChatUnreadBadge(userId).then(() => syncAppBadge(userId));
                },
            )
            .subscribe();

        // Invitaciones de plan: al borrarse (p. ej. plan eliminado) baja el badge de solicitudes.
        const inviteChannel = supabase
            .channel(`badge-invites-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'invitaciones_planes',
                    filter: `invitado_id=eq.${userId}`,
                },
                () => {
                    clearInviteSideEffects(userId);
                },
            )
            .subscribe();

        const subNet = subscribeNetwork((online) => {
            if (online) void flushChatOutbox();
        });

        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                void registerPushToken(userId);
                void syncAppBadge(userId);
                if (getIsOnline()) void flushChatOutbox();
            }
        });

        void (async () => {
            try {
                await new Promise<void>((r) => setTimeout(r, 80));
                const scheduledIds = new Set<string>();
                try {
                    const existing = await Notifications.getAllScheduledNotificationsAsync();
                    for (const item of existing) scheduledIds.add(item.identifier);
                } catch {
                    /* ignore */
                }
                const needsReminder = (planId: string, categoria?: string | null) => {
                    const group = isGroupOrChatPlan({ categoria });
                    const needToday = !group && !scheduledIds.has(`plan-today:${planId}`);
                    const needRating = !scheduledIds.has(`rating:${planId}`);
                    return needToday || needRating;
                };
                const markScheduled = (planId: string) => {
                    scheduledIds.add(`plan-today:${planId}`);
                    scheduledIds.add(`rating:${planId}`);
                };

                const pending = await getPendingRatingPlans(userId);
                const pendingIds = new Set(pending.map((plan) => plan.planId));
                for (const plan of pending) {
                    if (!needsReminder(plan.planId)) continue;
                    await schedulePlanLifecycleReminders({
                        planId: plan.planId,
                        planTitle: plan.titulo,
                        fechaEvento: plan.fecha_evento,
                    });
                    markScheduled(plan.planId);
                }

                const nowMs = Date.now();
                const { data: parts } = await supabase
                    .from('participantes')
                    .select('plan_id, planes(id, titulo, fecha_evento, categoria, nombre_ubicacion)')
                    .eq('usuario_id', userId)
                    .eq('estado', 'aceptado')
                    .limit(40);
                const eventAtByPlan = new Map<string, number>();
                for (const row of parts ?? []) {
                    const p = Array.isArray(row.planes) ? row.planes[0] : row.planes;
                    if (!p?.id || !p.fecha_evento) continue;
                    const at = new Date(p.fecha_evento).getTime();
                    if (Number.isFinite(at)) eventAtByPlan.set(p.id, at);
                }
                for (const ident of [...scheduledIds]) {
                    if (!ident.startsWith('rating:')) continue;
                    const planId = ident.slice('rating:'.length);
                    if (pendingIds.has(planId)) continue;
                    const at = eventAtByPlan.get(planId);
                    // Plan futuro: el aviso de valorar sigue programado. Si ya pasó y no está pendiente, era fantasma.
                    if (at != null && at < nowMs) {
                        await Notifications.cancelScheduledNotificationAsync(ident).catch(() => {});
                        scheduledIds.delete(ident);
                    }
                }
                for (const row of parts ?? []) {
                    const p = Array.isArray(row.planes) ? row.planes[0] : row.planes;
                    if (!p?.id || !needsReminder(p.id, p.categoria)) continue;
                    const eventAt = p.fecha_evento ? new Date(p.fecha_evento).getTime() : 0;
                    if (eventAt && eventAt < nowMs - 6 * 60 * 60 * 1000) continue;
                    await schedulePlanLifecycleReminders({
                        planId: p.id,
                        planTitle: p.titulo,
                        fechaEvento: p.fecha_evento,
                        categoria: p.categoria,
                        locationName: (p as { nombre_ubicacion?: string }).nombre_ubicacion,
                        includeRating: pendingIds.has(p.id),
                    });
                    markScheduled(p.id);
                }
            } catch {
                /* ignore */
            }
        })();

        return () => {
            sub.remove();
            subNet();
            unsubUnread();
            unsubNotif();
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(inviteChannel);
        };
    }, [userId, ready]);

    useEffect(() => {
        if (Platform.OS === 'web') return;

        const go = (raw: Record<string, unknown> | undefined) => {
            const data = normalizePushData(raw);
            const target = resolvePushNavigation(data);
            const href = target?.href ?? fallbackPushHref(data);
            if (!readyRef.current) {
                queuePushHref(href);
                return;
            }
            navigateAppHref(router, href);
            void warmPushDestination(data);
        };

        const handleResponse = (
            response: Notifications.NotificationResponse | null | undefined,
            fromColdStart = false,
        ) => {
            if (!response) return;
            const id = response.notification.request.identifier;
            void (async () => {
                if (fromColdStart) {
                    const raw = response.notification.date;
                    const at = raw > 1e12 ? raw : raw * 1000;
                    if (Number.isFinite(at) && Date.now() - at > 3 * 60 * 1000) {
                        await wasPushResponseHandled(id);
                        claimPushResponse(id);
                        return;
                    }
                }
                await wasPushResponseHandled(id);
                if (!claimPushResponse(id)) return;
                const data = response.notification.request.content.data as Record<string, unknown>;
                dismissPushFromPayload(data);
                void Notifications.dismissNotificationAsync(id).catch(() => {});
                const clearLast = (
                    Notifications as typeof Notifications & {
                        clearLastNotificationResponseAsync?: () => Promise<void>;
                    }
                ).clearLastNotificationResponseAsync;
                if (typeof clearLast === 'function') {
                    void clearLast().catch(() => {});
                }
                go(data);
            })();
        };

        const subRecv = Notifications.addNotificationResponseReceivedListener(handleResponse);

        const subShown = Notifications.addNotificationReceivedListener((notification) => {
            const content = notification.request.content;
            const data = normalizePushData(
                content.data as Record<string, unknown> | undefined,
            );
            // Calentar destino en cuanto llega la noti (antes de que el usuario pulse).
            if (data) void warmPushDestination(data);
            if (userId) {
                void refreshChatUnreadBadge(userId);
                const type = String(data?.type ?? '');
                if (type === 'plan_cancelled' || type === 'plan_invite') {
                    clearInviteSideEffects(userId);
                }
            }
            if (AppState.currentState !== 'active') return;
            if (shouldSuppressForeground(data)) return;
            const planId = data?.planId ? String(data.planId) : '';
            const screen = String(data?.screen ?? '');
            const type = String(data?.type ?? '');
            const title = String(content.title ?? '').trim();
            const body = String(content.body ?? '').trim();
            if (!title && !body) return;
            void (async () => {
                if (planId && (screen === 'chat' || type === 'plan_message')) {
                    const muted = await getMutedPlanChatIds();
                    if (muted.includes(planId)) return;
                }
                // iOS: el banner del sistema ya cubre el “arriba”.
                // Android: el heads-up en primer plano es poco fiable → toast in-app.
                if (Platform.OS !== 'android') return;
                hapticMedium();
                presentInAppToast({
                    id: notification.request.identifier,
                    title: title || 'Nexo!',
                    body,
                    avatarUrl: data?.avatarUrl ? String(data.avatarUrl) : undefined,
                    data,
                });
            })();
        });

        void Notifications.getLastNotificationResponseAsync().then((response) => {
            handleResponse(response, true);
        });

        return () => {
            subRecv.remove();
            subShown.remove();
        };
    }, [router, userId]);

    useEffect(() => {
        if (!ready) return;
        const href = takeQueuedPushHref();
        if (!href) return;
        navigateAppHref(router, href);
    }, [ready, router]);

    useEffect(() => {
        if (Platform.OS === 'web') return;

        const handledHrefRef = { current: null as string | null };
        const handledHrefAtRef = { current: 0 };

        const openUrl = (url: string | null) => {
            if (!url) return;
            if (handledUrlRef.current === url) return;
            const target = resolveDeepLinkUrl(url);
            if (!target) return;

            const now = Date.now();
            // Misma destino (https UL + nexo:// del landing) → una sola navegación
            if (handledHrefRef.current === target.href && now - handledHrefAtRef.current < 4500) {
                handledUrlRef.current = url;
                return;
            }

            handledUrlRef.current = url;
            handledHrefRef.current = target.href;
            handledHrefAtRef.current = now;

            // Calentar detalle/torneo en cuanto llega el link (antes de pintar).
            const planWarm = target.href.match(/^\/plan\/([0-9a-f-]{36})/i);
            if (planWarm?.[1]) {
                void prefetchPlanDetail(planWarm[1]);
                warmTournamentFromLink(planWarm[1]);
            }

            // Rutas de archivo (/plan/…) las abre Expo Router vía Universal/App Links.
            // Solo empujamos a mano share-plan (Supabase) y deep links tipo open?type=…
            let parsedHost = '';
            let parsedPath = '';
            try {
                const parsed = Linking.parse(url);
                parsedHost = (parsed.hostname || '').toLowerCase();
                parsedPath = (parsed.path || '').replace(/^\/+/, '');
            } catch {
                /* ignore */
            }
            const isShareFn =
                parsedHost.endsWith('.supabase.co')
                && /(^|\/)functions\/v1\/share-plan\//i.test(parsedPath);
            const isPushStyle =
                parsedHost === 'open'
                || parsedHost === 'push'
                || parsedHost === 'n'
                || /[?&](type|screen|planId)=/i.test(url);
            if (!isShareFn && !isPushStyle) {
                return;
            }

            requestAnimationFrame(() => {
                try {
                    if (target.href.startsWith('/plan/')) {
                        router.replace(target.href as never);
                    } else {
                        router.push(target.href as never);
                    }
                } catch {
                    /* ignore */
                }
            });
        };

        void Linking.getInitialURL().then(openUrl);
        const sub = Linking.addEventListener('url', ({ url }) => openUrl(url));
        return () => sub.remove();
    }, [router]);

    useEffect(() => {
        if (!userId) return;
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') {
                void unregisterPushToken(userId);
                void Notifications.setBadgeCountAsync(0).catch(() => {});
            }
        });
        return () => sub.subscription.unsubscribe();
    }, [userId]);

    return null;
}
