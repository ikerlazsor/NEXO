import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from './PressScale';
import { ProfileAvatar } from './ProfileAvatar';
import { getAuthUser } from '../lib/auth';
import { getUnreadChatCount, peekChatUnreadMap, subscribeChatUnread } from '../lib/chatUnread';
import { hapticLight, hapticMedium, hapticSelection } from '../lib/haptics';
import { useT } from '../lib/i18n';
import {
    getProfileNotificationCount,
    peekProfileNotificationCount,
    subscribeProfileNotifications,
} from '../lib/notifications';
import { scheduleHomePrefetch } from '../lib/prefetchHome';
import { emitFeedHomeRetap } from '../lib/feedReload';
import { cacheGetStale, cacheIsFresh, cacheSet } from '../lib/ttlCache';
import { supabase } from '../lib/supabase';

const CHROME_AVATAR_TTL_MS = 120_000;
const chromeAvatarKey = (userId: string) => `chromeAvatar:${userId}`;

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

export type MainTab = 'feed' | 'chats' | 'my-plans' | 'search';

type Props = {
    active?: MainTab;
    children: ReactNode;
};

function tabPath(tab: MainTab): '/' | '/chats' | '/my-plans' | '/search-profiles' {
    if (tab === 'feed') return '/';
    if (tab === 'chats') return '/chats';
    if (tab === 'my-plans') return '/my-plans';
    return '/search-profiles';
}

export function activeTabFromPathname(pathname: string): MainTab {
    if (pathname.includes('chats')) return 'chats';
    if (pathname.includes('my-plans')) return 'my-plans';
    if (pathname.includes('search-profiles')) return 'search';
    return 'feed';
}

export function MainChrome({ active: activeProp, children }: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const active = activeProp ?? activeTabFromPathname(pathname);
    const { t } = useT();
    const [userId, setUserId] = useState<string | null>(null);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [notifCount, setNotifCount] = useState(0);
    const [chatUnreadCount, setChatUnreadCount] = useState(0);
    const [openRatingsCount, setOpenRatingsCount] = useState(0);

    const hydrateChromeFromCache = useCallback((uid: string) => {
        const cachedAvatar = cacheGetStale<string | null>(chromeAvatarKey(uid));
        if (cachedAvatar !== null) setAvatarUrl(cachedAvatar);
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
        if (!user) return;
        setUserId(user.id);
        hydrateChromeFromCache(user.id);

        const notifFresh = cacheIsFresh(`notifCount:${user.id}`);
        const unreadFresh = cacheIsFresh(`chatUnread:${user.id}`);
        const avatarFresh = cacheIsFresh(chromeAvatarKey(user.id));
        if (!opts?.force && avatarFresh && notifFresh && unreadFresh) return;

        const [profileRes, notifs, unread] = await Promise.all([
            supabase.from('perfiles').select('avatar_url').eq('id', user.id).maybeSingle(),
            getProfileNotificationCount(user.id, opts),
            getUnreadChatCount(user.id, opts),
        ]);
        const nextAvatar =
            profileRes.data?.avatar_url || user.user_metadata?.avatar_url || null;
        cacheSet(chromeAvatarKey(user.id), nextAvatar, CHROME_AVATAR_TTL_MS);
        setAvatarUrl(nextAvatar);
        setNotifCount(notifs.total);
        setOpenRatingsCount(notifs.openRatings);
        setChatUnreadCount(unread);
    }, [hydrateChromeFromCache]);

    useFocusEffect(
        useCallback(() => {
            void refreshChrome();
            scheduleHomePrefetch();
            const unsub = subscribeChatUnread(() => {
                void getAuthUser().then((user) => {
                    if (user) void getUnreadChatCount(user.id, { force: true }).then(setChatUnreadCount);
                });
            });
            const unsubNotif = subscribeProfileNotifications(() => {
                void refreshChrome({ force: true });
            });
            return () => {
                unsub();
                unsubNotif();
            };
        }, [refreshChrome]),
    );

    const go = useCallback(
        (tab: MainTab) => {
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
        [active, router],
    );

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

            <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 12 }]}>
                <View style={styles.headerCopy}>
                    <Text style={styles.brand}>NEXO</Text>
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        style={styles.profileBtn}
                        onPress={() => {
                            hapticLight();
                            router.push('/profile');
                        }}
                        accessibilityLabel={t('profile.user')}
                        activeOpacity={0.88}
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
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.body}>{children}</View>

            <View
                style={[
                    styles.floatingBar,
                    {
                        bottom:
                            Platform.OS === 'android'
                                ? Math.max(insets.bottom, 28) + 12
                                : Math.max(insets.bottom, 16) + 14,
                    },
                ]}
            >
                <PressScale
                    style={[styles.floatingBtn, active === 'chats' && styles.floatingBtnActive]}
                    onPress={() => go('chats')}
                    accessibilityLabel={t('chats.title')}
                    haptic={false}
                >
                    <Ionicons name="chatbubbles" size={22} color="#fff" />
                    {chatUnreadCount > 0 && (
                        <View style={styles.chatNotifBadge}>
                            <Text style={styles.chatNotifText}>
                                {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                            </Text>
                        </View>
                    )}
                </PressScale>

                <PressScale
                    style={[styles.floatingBtn, active === 'my-plans' && styles.floatingBtnActive]}
                    onPress={() => go('my-plans')}
                    accessibilityLabel={t('myplans.title')}
                    haptic={false}
                >
                    <Ionicons name="albums" size={22} color="#fff" />
                    {openRatingsCount > 0 && (
                        <View style={styles.chatNotifBadge}>
                            <Text style={styles.chatNotifText}>
                                {openRatingsCount > 9 ? '9+' : openRatingsCount}
                            </Text>
                        </View>
                    )}
                </PressScale>

                <PressScale
                    style={[styles.floatingBtn, active === 'feed' && styles.floatingBtnActive]}
                    onPress={() => go('feed')}
                    accessibilityLabel={t('feed.greeting')}
                    haptic={false}
                >
                    <Ionicons name="home" size={22} color="#fff" />
                </PressScale>

                <PressScale
                    style={[styles.floatingBtn, active === 'search' && styles.floatingBtnActive]}
                    onPress={() => go('search')}
                    accessibilityLabel={t('feed.searchProfiles')}
                    haptic={false}
                >
                    <Ionicons name="search" size={22} color="#fff" />
                </PressScale>

                <PressScale
                    style={styles.floatingBtn}
                    haptic={false}
                    onPress={() => {
                        hapticMedium();
                        router.push('/create-plan');
                    }}
                    accessibilityLabel={t('feed.create')}
                    pressedScale={0.92}
                >
                    <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.floatingBtnGradient}>
                        <Ionicons name="add" size={26} color="#fff" />
                    </LinearGradient>
                </PressScale>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginBottom: 12,
    },
    headerCopy: { flex: 1, paddingRight: 16 },
    brand: { color: INK, fontSize: 24, fontWeight: '900', letterSpacing: 1.2 },
    headerRight: { flexDirection: 'row', alignItems: 'center' },
    profileBtn: { padding: 2 },
    profileAvatarWrap: { position: 'relative' },
    profileNotifBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: '#FFF',
    },
    profileNotifText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    body: { flex: 1 },
    floatingBar: {
        position: 'absolute',
        left: 20,
        right: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: INK,
        borderRadius: 26,
        paddingVertical: 8,
        paddingHorizontal: 8,
        elevation: 14,
        shadowColor: INK,
        shadowOpacity: 0.35,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
    },
    floatingBtn: {
        width: 46,
        height: 46,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    floatingBtnActive: {
        backgroundColor: 'rgba(255,255,255,0.16)',
    },
    chatNotifBadge: {
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: INK,
    },
    chatNotifText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    floatingBtnGradient: {
        width: 46,
        height: 46,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
