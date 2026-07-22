import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { LangPicker } from './LangPicker';
import { ProfileAvatar } from './ProfileAvatar';
import { getAuthUser } from '../lib/auth';
import { getUnreadChatCount, peekChatUnreadMap, subscribeChatUnread } from '../lib/chatUnread';
import { useT } from '../lib/i18n';
import { consumeMainTabEnterDir, peekMainTabEnterDir, setMainTabEnterDir } from '../lib/mainTabNav';
import { getProfileNotificationCount, peekProfileNotificationCount } from '../lib/notifications';
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

const SLIDE_MS = 220;
const SLIDE_EASING = Easing.out(Easing.cubic);

function initialTranslateX(width: number): number {
    const dir = peekMainTabEnterDir();
    if (dir === 1) return width;
    if (dir === -1) return -width;
    return 0;
}

export type MainTab = 'feed' | 'chats' | 'my-plans' | 'search';

/** Orden de la barra inferior (sin el +). */
const SWIPE_TABS: MainTab[] = ['chats', 'my-plans', 'feed', 'search'];

type Props = {
    active: MainTab;
    children: ReactNode;
};

function tabPath(tab: MainTab): '/' | '/chats' | '/my-plans' | '/search-profiles' {
    if (tab === 'feed') return '/';
    if (tab === 'chats') return '/chats';
    if (tab === 'my-plans') return '/my-plans';
    return '/search-profiles';
}

export function MainChrome({ active, children }: Props) {
    const router = useRouter();
    const isFocused = useIsFocused();
    const { t, lang, setLang } = useT();
    const [userId, setUserId] = useState<string | null>(null);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [notifCount, setNotifCount] = useState(0);
    const [chatUnreadCount, setChatUnreadCount] = useState(0);
    const [openRatingsCount, setOpenRatingsCount] = useState(0);

    const screenWidth = Dimensions.get('window').width;
    const translateX = useSharedValue(initialTranslateX(screenWidth));
    const animating = useSharedValue(false);
    const canGoPrev = useSharedValue(false);
    const canGoNext = useSharedValue(false);
    const widthSV = useSharedValue(screenWidth);

    useEffect(() => {
        const idx = SWIPE_TABS.indexOf(active);
        canGoPrev.value = idx > 0;
        canGoNext.value = idx >= 0 && idx < SWIPE_TABS.length - 1;
        widthSV.value = screenWidth;
    }, [active, screenWidth, canGoPrev, canGoNext, widthSV]);

    // Antes del paint: la pantalla nueva entra desde el lado (evita flash en el centro).
    useLayoutEffect(() => {
        if (!isFocused) return;
        const dir = consumeMainTabEnterDir();
        animating.value = false;
        if (dir === 1) {
            // Ya puede estar en screenWidth por el valor inicial; forzar y animar a 0.
            translateX.value = screenWidth;
            translateX.value = withTiming(0, { duration: SLIDE_MS, easing: SLIDE_EASING });
        } else if (dir === -1) {
            translateX.value = -screenWidth;
            translateX.value = withTiming(0, { duration: SLIDE_MS, easing: SLIDE_EASING });
        } else {
            translateX.value = 0;
        }
    }, [isFocused, screenWidth, translateX, animating]);

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
            return unsub;
        }, [refreshChrome]),
    );

    const navigateTo = useCallback(
        (tab: MainTab) => {
            router.replace(tabPath(tab));
        },
        [router],
    );

    const commitTabChange = useCallback(
        (tab: MainTab, dir: -1 | 1) => {
            setMainTabEnterDir(dir);
            navigateTo(tab);
        },
        [navigateTo],
    );

    const goAdjacent = useCallback(
        (direction: -1 | 1, withEnterAnim = true) => {
            const idx = SWIPE_TABS.indexOf(active);
            if (idx < 0) return;
            const next = SWIPE_TABS[idx + direction];
            if (!next) return;
            if (withEnterAnim) {
                commitTabChange(next, direction);
            } else {
                // La salida ya empujó la pantalla fuera: el destino aparece centrado (sin segundo tirón).
                setMainTabEnterDir(0);
                navigateTo(next);
            }
        },
        [active, commitTabChange, navigateTo],
    );

    const go = useCallback(
        (tab: MainTab) => {
            if (tab === 'feed' && active === 'feed') {
                emitFeedHomeRetap();
                return;
            }
            if (tab === active || animating.value) return;
            // Tap en la barra: cambio instantáneo, sin animación de deslizamiento.
            setMainTabEnterDir(0);
            translateX.value = 0;
            navigateTo(tab);
        },
        [active, animating, navigateTo, translateX],
    );

    const swipeGesture = useMemo(
        () =>
            Gesture.Pan()
                // Prioriza scroll vertical: solo activa el cambio de pestaña con gesto claramente horizontal.
                .activeOffsetX([-48, 48])
                .failOffsetY([-8, 8])
                .maxPointers(1)
                .onUpdate((e) => {
                    'worklet';
                    if (animating.value) return;
                    let x = e.translationX;
                    if (x < 0 && !canGoNext.value) x *= 0.18;
                    if (x > 0 && !canGoPrev.value) x *= 0.18;
                    translateX.value = x;
                })
                .onEnd((e) => {
                    'worklet';
                    if (animating.value) return;
                    const dist = e.translationX;
                    const vel = e.velocityX;
                    const goNext = (dist < -72 || vel < -750) && canGoNext.value;
                    const goPrev = (dist > 72 || vel > 750) && canGoPrev.value;

                    if (goNext) {
                        // Completar la salida sin resetear a 0 (el reset a mitad causaba el tirón).
                        animating.value = true;
                        translateX.value = withTiming(
                            -widthSV.value,
                            { duration: SLIDE_MS, easing: SLIDE_EASING },
                            (finished) => {
                                if (finished) runOnJS(goAdjacent)(1, false);
                            },
                        );
                    } else if (goPrev) {
                        animating.value = true;
                        translateX.value = withTiming(
                            widthSV.value,
                            { duration: SLIDE_MS, easing: SLIDE_EASING },
                            (finished) => {
                                if (finished) runOnJS(goAdjacent)(-1, false);
                            },
                        );
                    } else {
                        translateX.value = withTiming(0, {
                            duration: 200,
                            easing: SLIDE_EASING,
                        });
                    }
                }),
        [animating, canGoNext, canGoPrev, goAdjacent, translateX, widthSV],
    );

    const bodyStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

            <View style={styles.header}>
                <View style={styles.headerSpacer} />
                <View style={styles.headerRight}>
                    <LangPicker lang={lang} onChange={setLang} compact />
                    <TouchableOpacity
                        style={styles.profileBtn}
                        onPress={() => router.push('/profile')}
                        accessibilityLabel={t('profile.user')}
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

            <View style={styles.bodyClip}>
                <GestureDetector gesture={swipeGesture}>
                    <Animated.View style={[styles.body, bodyStyle]}>{children}</Animated.View>
                </GestureDetector>
            </View>

            <View style={styles.floatingBar}>
                <TouchableOpacity
                    style={[styles.floatingBtn, active === 'chats' && styles.floatingBtnActive]}
                    onPress={() => go('chats')}
                    activeOpacity={0.9}
                >
                    <Ionicons name="chatbubbles" size={22} color="#fff" />
                    {chatUnreadCount > 0 && (
                        <View style={styles.chatNotifBadge}>
                            <Text style={styles.chatNotifText}>
                                {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.floatingBtn, active === 'my-plans' && styles.floatingBtnActive]}
                    onPress={() => go('my-plans')}
                    activeOpacity={0.9}
                >
                    <Ionicons name="albums" size={22} color="#fff" />
                    {openRatingsCount > 0 && (
                        <View style={styles.chatNotifBadge}>
                            <Text style={styles.chatNotifText}>
                                {openRatingsCount > 9 ? '9+' : openRatingsCount}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.floatingBtn, active === 'feed' && styles.floatingBtnActive]}
                    onPress={() => go('feed')}
                    activeOpacity={0.9}
                >
                    <Ionicons name="home" size={22} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.floatingBtn, active === 'search' && styles.floatingBtnActive]}
                    onPress={() => go('search')}
                    activeOpacity={0.9}
                >
                    <Ionicons name="search" size={22} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.floatingBtn}
                    onPress={() => router.push('/create-plan')}
                    activeOpacity={0.9}
                >
                    <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.floatingBtnGradient}>
                        <Ionicons name="add" size={26} color="#fff" />
                    </LinearGradient>
                </TouchableOpacity>
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
        paddingTop: Platform.OS === 'ios' ? 60 : 48,
        paddingHorizontal: 24,
        marginBottom: 12,
    },
    headerSpacer: { flex: 1 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
    bodyClip: { flex: 1, overflow: 'hidden' },
    body: { flex: 1 },
    floatingBar: {
        position: 'absolute',
        bottom: 28,
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
