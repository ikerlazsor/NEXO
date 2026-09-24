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
import { getUnreadChatCount, subscribeChatUnread } from '../lib/chatUnread';
import { resolveDeepLinkUrl } from '../lib/deepLinks';
import { hapticMedium } from '../lib/haptics';
import { presentInAppToast } from '../lib/inAppToast';
import { getIsOnline, subscribeNetwork } from '../lib/network';
import {
    getProfileNotificationCount,
    subscribeProfileNotifications,
} from '../lib/notifications';
import { dismissPushFromPayload } from '../lib/presentedPush';
import { syncNotificationCategoryPrefsFromServer } from '../lib/notificationPrefs';
import {
    bootstrapPushForUser,
    normalizePushData,
    registerPushToken,
    resolvePushNavigation,
    schedulePlanLifecycleReminders,
    syncPushPreferenceFromServer,
    unregisterPushToken,
} from '../lib/push';
import { warmPushDestination } from '../lib/pushWarm';
import { getPendingRatingPlans } from '../lib/ratings';
import { supabase } from '../lib/supabase';

async function syncAppBadge(userId: string) {
    try {
        const [chats, notifs] = await Promise.all([
            getUnreadChatCount(userId),
            getProfileNotificationCount(userId),
        ]);
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
    const handledRef = useRef<string | null>(null);
    const handledUrlRef = useRef<string | null>(null);

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

                if (AppState.currentState === 'active') {
                    return {
                        shouldShowBanner: false,
                        shouldShowList: false,
                        shouldPlaySound: false,
                        shouldSetBadge: true,
                    };
                }

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

        const unsubUnread = subscribeChatUnread(() => {
            void syncAppBadge(userId);
        });
        const unsubNotif = subscribeProfileNotifications(() => {
            void syncAppBadge(userId);
        });

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
                const pending = await getPendingRatingPlans(userId);
                for (const plan of pending) {
                    await schedulePlanLifecycleReminders({
                        planId: plan.planId,
                        planTitle: plan.titulo,
                        fechaEvento: plan.fecha_evento,
                    });
                    await new Promise<void>((r) => setTimeout(r, 40));
                }

                const nowIso = new Date().toISOString();
                const { data: parts } = await supabase
                    .from('participantes')
                    .select('plan_id, planes(id, titulo, fecha_evento, categoria, nombre_ubicacion)')
                    .eq('usuario_id', userId)
                    .eq('estado', 'aceptado')
                    .limit(40);
                for (const row of parts ?? []) {
                    const p = Array.isArray(row.planes) ? row.planes[0] : row.planes;
                    if (!p?.id) continue;
                    const eventAt = p.fecha_evento ? new Date(p.fecha_evento).getTime() : 0;
                    if (eventAt && eventAt < Date.parse(nowIso) - 6 * 60 * 60 * 1000) continue;
                    await schedulePlanLifecycleReminders({
                        planId: p.id,
                        planTitle: p.titulo,
                        fechaEvento: p.fecha_evento,
                        categoria: p.categoria,
                        locationName: (p as { nombre_ubicacion?: string }).nombre_ubicacion,
                    });
                    await new Promise<void>((r) => setTimeout(r, 40));
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
        };
    }, [userId, ready]);

    useEffect(() => {
        if (Platform.OS === 'web') return;

        const go = (raw: Record<string, unknown> | undefined) => {
            const data = normalizePushData(raw);
            const target = resolvePushNavigation(data);
            if (!target) return;
            // Navegar YA; calentar en paralelo (antes se esperaba warm → freeze / destino perdido).
            let tries = 0;
            const attempt = () => {
                tries += 1;
                try {
                    router.push(target.href as never);
                } catch {
                    if (tries < 8) setTimeout(attempt, 140 * tries);
                }
            };
            attempt();
            void warmPushDestination(data);
        };

        const handleResponse = (response: Notifications.NotificationResponse | null | undefined) => {
            if (!response) return;
            const id = response.notification.request.identifier;
            if (handledRef.current === id) return;
            handledRef.current = id;
            const data = response.notification.request.content.data as Record<string, unknown>;
            dismissPushFromPayload(data);
            void Notifications.dismissNotificationAsync(id).catch(() => {});
            // Evita re-navegar en el siguiente cold start con la misma respuesta.
            const clearLast = (
                Notifications as typeof Notifications & {
                    clearLastNotificationResponseAsync?: () => Promise<void>;
                }
            ).clearLastNotificationResponseAsync;
            if (typeof clearLast === 'function') {
                void clearLast().catch(() => {});
            }
            go(data);
        };

        const subRecv = Notifications.addNotificationResponseReceivedListener(handleResponse);

        const subShown = Notifications.addNotificationReceivedListener((notification) => {
            const content = notification.request.content;
            const data = normalizePushData(
                content.data as Record<string, unknown> | undefined,
            );
            // Calentar destino en cuanto llega la noti (antes de que el usuario pulse).
            if (data) void warmPushDestination(data);
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

        void Notifications.getLastNotificationResponseAsync().then(handleResponse);

        return () => {
            subRecv.remove();
            subShown.remove();
        };
    }, [router]);

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
