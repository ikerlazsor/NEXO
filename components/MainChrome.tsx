import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from './PressScale';
import { ProfileAvatar } from './ProfileAvatar';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import {
    chromeAvatarKey,
    hydrateChromeAvatarFromDisk,
    peekChromeAvatar,
    rememberChromeAvatar,
} from '../lib/chromeAvatar';
import { getUnreadChatCount, peekChatUnreadMap, subscribeChatUnread } from '../lib/chatUnread';
import { hapticLight, hapticMedium, hapticSelection } from '../lib/haptics';
import { useT } from '../lib/i18n';
import {
    getProfileNotificationCount,
    peekProfileNotificationCount,
    subscribeProfileNotifications,
} from '../lib/notifications';
import { ensureBackgroundPrefetchLifecycle, scheduleHomePrefetch } from '../lib/prefetchHome';
import { emitFeedHomeRetap } from '../lib/feedReload';
import { requestOpenFeedMap } from '../lib/feedMapIntent';
import { FeedMapHost } from './FeedMapHost';
import { NativeMapWarmHost } from './NativeMapWarmHost';
import { PeopleSearchIcon } from './PeopleSearchIcon';
import { cacheGetStale, cacheIsFresh } from '../lib/ttlCache';
import { screenCacheKey } from '../lib/screenCaches';
import { supabase } from '../lib/supabase';
import { rememberViewerIsOrganizer } from '../lib/organizer';
import { subscribeCreatePlan, notifyCreatePlanClosed } from '../lib/createPlanIntent';
import { theme, type ThemeColors } from '../theme';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';

const HEADER_SIDE_PAD = 20;
const HEADER_AVATAR = 44;
const HEADER_ROW = 48;
const HEADER_GAP = 10;

function createChromeStyles(c: ThemeColors) {
    return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.backgroundAlt },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingHorizontal: HEADER_SIDE_PAD,
        pointerEvents: 'box-none',
    },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerIconBtn: {
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: c.surface,
        borderRadius: 14,
        elevation: 3,
        shadowColor: c.primary,
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    guestCta: {
        backgroundColor: c.primary,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: theme.accessibility.minimumTouchTarget,
        justifyContent: 'center',
    },
    guestCtaText: { color: c.onPrimary, fontSize: 13, fontWeight: '800' },
    profileBtn: { minWidth: theme.accessibility.minimumTouchTarget, minHeight: theme.accessibility.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
    profileAvatarWrap: { position: 'relative' },
    profileNotifBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: c.primary,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: c.surface,
    },
    profileNotifText: { color: c.onPrimary, fontSize: 10, fontWeight: '800' },
    body: { flex: 1 },
    floatingBar: {
        position: 'absolute',
        left: 28,
        right: 28,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c.tabBar,
        borderRadius: 26,
        paddingVertical: 3,
        paddingHorizontal: 4,
        elevation: 14,
        shadowColor: c.tabBar,
        shadowOpacity: 0.35,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
    },
    floatingBtn: {
        flex: 1,
        minWidth: 0,
        minHeight: 46,
        borderRadius: 18,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 3,
        paddingBottom: 3,
        gap: 1,
        position: 'relative',
    },
    floatingIconSlot: {
        height: 24,
        width: 28,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    floatingBtnActive: {
        backgroundColor: 'rgba(255,255,255,0.16)',
    },
    floatingBtnLabel: {
        color: c.onTabBar,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: -0.2,
        opacity: 0.78,
        lineHeight: 12,
    },
    floatingBtnLabelActive: {
        opacity: 1,
        fontWeight: '800',
    },
    chatNotifBadge: {
        position: 'absolute',
        top: -5,
        right: -8,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: c.primary,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 3,
        borderWidth: 2,
        borderColor: c.tabBar,
        zIndex: 2,
    },
    chatNotifText: { color: c.onPrimary, fontSize: 9, fontWeight: '800' },
    });
}

export type ChromeHeaderLayout = {
    headerTop: number;
    headerRowHeight: number;
    headerRight: number;
};

const ChromeHeaderLayoutContext = createContext<ChromeHeaderLayout>({
    headerTop: 54,
    headerRowHeight: HEADER_ROW,
    headerRight: HEADER_SIDE_PAD + HEADER_AVATAR + HEADER_GAP,
});

export function useChromeHeaderLayout() {
    return useContext(ChromeHeaderLayoutContext);
}

export type MainTab = 'feed' | 'chats' | 'my-plans';

type Props = {
    active?: MainTab;
    children: ReactNode;
};

function tabPath(tab: MainTab): '/' | '/chats' | '/my-plans' {
    if (tab === 'feed') return '/';
    if (tab === 'chats') return '/chats';
    return '/my-plans';
}

export function activeTabFromPathname(pathname: string): MainTab {
    if (pathname.includes('chats')) return 'chats';
    if (pathname.includes('my-plans')) return 'my-plans';
    return 'feed';
}

export function MainChrome({ active: activeProp, children }: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const active = activeProp ?? activeTabFromPathname(pathname);
    const { t } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createChromeStyles);
    const { isGuest, requireAccount, session, userId: sessionUserId } = useAuthSession();
    const sessionAvatar =
        typeof session?.user?.user_metadata?.avatar_url === 'string'
            ? session.user.user_metadata.avatar_url
            : null;
    const [userId, setUserId] = useState<string | null>(() => sessionUserId);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
        if (!sessionUserId) return null;
        return (
            peekChromeAvatar(sessionUserId) ||
            cacheGetStale<{ avatarUrl?: string | null }>(screenCacheKey.profileUI(sessionUserId))
                ?.avatarUrl ||
            sessionAvatar ||
            null
        );
    });
    const [notifCount, setNotifCount] = useState(0);
    const [chatUnreadCount, setChatUnreadCount] = useState(0);
    const [openRatingsCount, setOpenRatingsCount] = useState(0);
    const [rightClusterWidth, setRightClusterWidth] = useState(HEADER_ROW);

    const headerTop = insets.top + 6;
    const headerLayout = useMemo<ChromeHeaderLayout>(
        () => ({
            headerTop,
            headerRowHeight: HEADER_ROW,
            headerRight: HEADER_SIDE_PAD + rightClusterWidth + HEADER_GAP,
        }),
        [headerTop, rightClusterWidth],
    );

    const hydrateChromeFromCache = useCallback((uid: string) => {
        const cachedAvatar =
            peekChromeAvatar(uid) ||
            cacheGetStale<{ avatarUrl?: string | null }>(screenCacheKey.profileUI(uid))?.avatarUrl ||
            null;
        if (cachedAvatar) setAvatarUrl(cachedAvatar);
        const notifs = peekProfileNotificationCount(uid);
        if (notifs) {
            setNotifCount(notifs.total);
            setOpenRatingsCount(notifs.openRatings);
        }
        const unread = peekChatUnreadMap(uid);
        if (unread) setChatUnreadCount(unread.total);
    }, []);

    const refreshChrome = useCallback(async (opts?: { force?: boolean }) => {
        const user = await getAuthUser();
        if (!user) {
            rememberViewerIsOrganizer(false);
            return;
        }
        setUserId(user.id);
        hydrateChromeFromCache(user.id);

        const notifFresh = cacheIsFresh(`notifCount:${user.id}`);
        const unreadFresh = cacheIsFresh(`chatUnread:${user.id}`);
        const avatarFresh = cacheIsFresh(chromeAvatarKey(user.id));
        if (!opts?.force && avatarFresh && notifFresh && unreadFresh) return;

        const [profileRes, notifs, unread] = await Promise.all([
            supabase.from('perfiles').select('avatar_url, es_organizador').eq('id', user.id).maybeSingle(),
            getProfileNotificationCount(user.id, opts),
            getUnreadChatCount(user.id, opts),
        ]);
        rememberViewerIsOrganizer(profileRes.data?.es_organizador === true);
        const nextAvatar =
            profileRes.data?.avatar_url || user.user_metadata?.avatar_url || null;
        rememberChromeAvatar(user.id, nextAvatar);
        setAvatarUrl(nextAvatar);
        setNotifCount(notifs.total);
        setOpenRatingsCount(notifs.openRatings);
        setChatUnreadCount(unread);
    }, [hydrateChromeFromCache]);

    // Cold start: disco + metadata de sesión antes de que llegue la red.
    useEffect(() => {
        if (!sessionUserId) {
            setAvatarUrl(null);
            setUserId(null);
            return;
        }
        setUserId(sessionUserId);
        if (sessionAvatar && !avatarUrl) setAvatarUrl(sessionAvatar);
        hydrateChromeFromCache(sessionUserId);
        let cancelled = false;
        void hydrateChromeAvatarFromDisk(sessionUserId).then((url) => {
            if (!cancelled && url) setAvatarUrl(url);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de sesión
    }, [sessionUserId, sessionAvatar, hydrateChromeFromCache]);

    useFocusEffect(
        useCallback(() => {
            ensureBackgroundPrefetchLifecycle();
            void refreshChrome();
            scheduleHomePrefetch();
        }, [refreshChrome]),
    );

    // Escucha siempre (aunque el tab no tenga foco): atender noti desde chats/plan/perfil baja el badge al instante.
    useEffect(() => {
        if (!sessionUserId) return;
        const uid = sessionUserId;
        const unsub = subscribeChatUnread(() => {
            const peek = peekChatUnreadMap(uid);
            if (peek) setChatUnreadCount(peek.total);
            else void getUnreadChatCount(uid, { force: true }).then(setChatUnreadCount);
        });
        const unsubNotif = subscribeProfileNotifications(() => {
            const peek = peekProfileNotificationCount(uid);
            if (peek) {
                setNotifCount(peek.total);
                setOpenRatingsCount(peek.openRatings);
            } else {
                void refreshChrome({ force: true });
            }
        });
        return () => {
            unsub();
            unsubNotif();
        };
    }, [sessionUserId, refreshChrome]);

    const go = useCallback(
        (tab: MainTab) => {
            if (isGuest && tab !== 'feed') {
                requireAccount(
                    tab === 'chats' ? { type: 'chats' } : { type: 'my-plans' },
                );
                return;
            }
            if (tab === 'feed' && active === 'feed') {
                hapticSelection();
                emitFeedHomeRetap();
                return;
            }
            if (tab === active) {
                hapticSelection();
                return;
            }
            hapticLight();
            router.navigate(tabPath(tab));
        },
        [active, isGuest, requireAccount, router],
    );

    const openPeopleSearch = useCallback(() => {
        if (requireAccount({ type: 'search' })) return;
        hapticLight();
        router.push('/search-profiles');
    }, [requireAccount, router]);

    const openMap = useCallback(() => {
        hapticLight();
        requestOpenFeedMap();
    }, []);

    const openCreate = useCallback(() => {
        if (pathname.includes('create-plan')) return;
        if (requireAccount({ type: 'create-plan' })) return;
        hapticMedium();
        router.push('/create-plan');
    }, [pathname, requireAccount, router]);

    useEffect(() => subscribeCreatePlan(openCreate), [openCreate]);

    const wasCreateRef = useRef(pathname.includes('create-plan'));
    useEffect(() => {
        const isCreate = pathname.includes('create-plan');
        if (wasCreateRef.current && !isCreate) notifyCreatePlanClosed();
        wasCreateRef.current = isCreate;
    }, [pathname]);

    return (
        <ChromeHeaderLayoutContext.Provider value={headerLayout}>
        <View style={styles.container}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />

            <View style={styles.body}>{children}</View>
            <NativeMapWarmHost />
            <FeedMapHost />

            <View
                pointerEvents="box-none"
                style={[
                    styles.header,
                    {
                        paddingTop: headerTop,
                        height: headerTop + HEADER_ROW,
                    },
                ]}
            >
                <View
                    style={styles.headerRight}
                    onLayout={(e) => {
                        const w = Math.round(e.nativeEvent.layout.width);
                        if (w > 0 && w !== rightClusterWidth) setRightClusterWidth(w);
                    }}
                >
                    {isGuest ? (
                        <>
                            <TouchableOpacity
                                style={styles.profileBtn}
                                onPress={() => {
                                    hapticLight();
                                    router.push('/settings');
                                }}
                                accessibilityLabel={t('settings.title')}
                                activeOpacity={0.88}
                            >
                                <Ionicons name="settings-outline" size={24} color={colors.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.guestCta}
                                onPress={() => {
                                    hapticMedium();
                                    requireAccount({ type: 'generic' });
                                }}
                                accessibilityLabel={t('login.tabRegister')}
                                activeOpacity={0.88}
                            >
                                <Text style={styles.guestCtaText}>{t('login.tabRegister')}</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                        <TouchableOpacity
                            style={styles.headerIconBtn}
                            onPress={openPeopleSearch}
                            accessibilityLabel={t('profile.searchUsers')}
                            activeOpacity={0.88}
                            hitSlop={6}
                        >
                            <PeopleSearchIcon size={24} color={colors.text} />
                        </TouchableOpacity>
                        <PressScale
                            style={styles.profileBtn}
                            onPress={() => {
                                hapticLight();
                                router.push('/profile');
                            }}
                            accessibilityLabel={t('profile.user')}
                            pressedScale={0.94}
                            haptic={false}
                        >
                            <View style={styles.profileAvatarWrap}>
                                <ProfileAvatar uri={avatarUrl} name="U" size={44} recyclingKey={userId ?? undefined} />
                                {notifCount > 0 && (
                                    <View style={styles.profileNotifBadge}>
                                        <Text style={styles.profileNotifText}>
                                            {notifCount > 9 ? '9+' : notifCount}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </PressScale>
                        </>
                    )}
                </View>
            </View>

            <View
                style={[
                    styles.floatingBar,
                    {
                        bottom: Math.max(insets.bottom - 8, 4),
                    },
                ]}
            >
                <PressScale
                    style={[styles.floatingBtn, active === 'feed' && styles.floatingBtnActive]}
                    onPress={() => go('feed')}
                    accessibilityLabel={t('tabs.feed')}
                    haptic={false}
                    pressedScale={0.94}
                >
                    <View style={styles.floatingIconSlot}>
                    <Ionicons name="compass" size={24} color={colors.onTabBar} />
                    </View>
                    <Text
                        style={[styles.floatingBtnLabel, active === 'feed' && styles.floatingBtnLabelActive]}
                        numberOfLines={1}
                    >
                        {t('tabs.feed')}
                    </Text>
                </PressScale>

                <PressScale
                    style={styles.floatingBtn}
                    onPress={openMap}
                    accessibilityLabel={t('tabs.map')}
                    haptic={false}
                    pressedScale={0.94}
                >
                    <View style={styles.floatingIconSlot}>
                    <Ionicons name="map" size={24} color={colors.onTabBar} />
                    </View>
                    <Text style={styles.floatingBtnLabel} numberOfLines={1}>
                        {t('tabs.map')}
                    </Text>
                </PressScale>

                <PressScale
                    style={[styles.floatingBtn, active === 'chats' && styles.floatingBtnActive]}
                    onPress={() => go('chats')}
                    accessibilityLabel={t('chats.title')}
                    haptic={false}
                    pressedScale={0.94}
                >
                    <View style={styles.floatingIconSlot}>
                        <Ionicons name="chatbubbles" size={24} color={colors.onTabBar} />
                        {chatUnreadCount > 0 && (
                            <View style={styles.chatNotifBadge}>
                                <Text style={styles.chatNotifText}>
                                    {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                                </Text>
                            </View>
                        )}
                    </View>
                    <Text
                        style={[styles.floatingBtnLabel, active === 'chats' && styles.floatingBtnLabelActive]}
                        numberOfLines={1}
                    >
                        {t('tabs.chats')}
                    </Text>
                </PressScale>

                <PressScale
                    style={styles.floatingBtn}
                    haptic={false}
                    onPress={openCreate}
                    accessibilityLabel={t('feed.create')}
                    pressedScale={0.94}
                >
                    <View style={styles.floatingIconSlot}>
                    <Ionicons name="add-circle" size={24} color={colors.onTabBar} />
                    </View>
                    <Text style={styles.floatingBtnLabel} numberOfLines={1}>
                        {t('tabs.create')}
                    </Text>
                </PressScale>
            </View>
        </View>
        </ChromeHeaderLayoutContext.Provider>
    );
}
