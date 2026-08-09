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
import { getIsOnline, subscribeNetwork } from '../lib/network';
import {
    getProfileNotificationCount,
    subscribeProfileNotifications,
} from '../lib/notifications';
import { syncNotificationCategoryPrefsFromServer } from '../lib/notificationPrefs';
import {
    registerPushToken,
    resolvePushNavigation,
    schedulePlanLifecycleReminders,
    syncPushPreferenceFromServer,
    unregisterPushToken,
} from '../lib/push';
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

function shouldSuppressForeground(data: Record<string, unknown> | undefined): boolean {
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
 */
export function PushBootstrap({ userId }: { userId: string | null }) {
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

        void (async () => {
            const enabled = await syncPushPreferenceFromServer(userId);
            await syncNotificationCategoryPrefsFromServer(userId);
            await syncPlanChatMutesFromServer(userId);
            if (enabled) await registerPushToken(userId);
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
                const pending = await getPendingRatingPlans(userId);
                for (const plan of pending) {
                    await schedulePlanLifecycleReminders({
                        planId: plan.planId,
                        planTitle: plan.titulo,
                        fechaEvento: plan.fecha_evento,
                    });
                }

                const { data: parts } = await supabase
                    .from('participantes')
                    .select('plan_id, planes(id, titulo, fecha_evento, categoria, nombre_ubicacion)')
                    .eq('usuario_id', userId)
                    .eq('estado', 'aceptado');
                for (const row of parts ?? []) {
                    const p = Array.isArray(row.planes) ? row.planes[0] : row.planes;
                    if (!p?.id) continue;
                    await schedulePlanLifecycleReminders({
                        planId: p.id,
                        planTitle: p.titulo,
                        fechaEvento: p.fecha_evento,
                        categoria: p.categoria,
                        locationName: (p as { nombre_ubicacion?: string }).nombre_ubicacion,
                    });
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
    }, [userId]);

    useEffect(() => {
        if (Platform.OS === 'web') return;

        const go = (data: Record<string, unknown> | undefined) => {
            const target = resolvePushNavigation(data);
            if (!target) return;
            // Pequeño defer: al cold-start el router a veces aún no está listo.
            requestAnimationFrame(() => {
                router.push(target.href as never);
            });
        };

        const subRecv = Notifications.addNotificationResponseReceivedListener((response) => {
            const id = response.notification.request.identifier;
            if (handledRef.current === id) return;
            handledRef.current = id;
            go(response.notification.request.content.data as Record<string, unknown>);
        });

        void Notifications.getLastNotificationResponseAsync().then((response) => {
            if (!response) return;
            const id = response.notification.request.identifier;
            if (handledRef.current === id) return;
            handledRef.current = id;
            go(response.notification.request.content.data as Record<string, unknown>);
        });

        return () => subRecv.remove();
    }, [router]);

    useEffect(() => {
        if (Platform.OS === 'web') return;

        const openUrl = (url: string | null) => {
            if (!url || handledUrlRef.current === url) return;
            const target = resolveDeepLinkUrl(url);
            if (!target) return;
            handledUrlRef.current = url;
            requestAnimationFrame(() => {
                router.push(target.href as never);
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
