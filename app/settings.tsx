import {
    Ionicons
} from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
    useFocusEffect,
    useRouter
} from 'expo-router';
import {
    useCallback,
    useState
} from 'react';
import {
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LangPicker } from '../components/LangPicker';
import { ScreenHeader } from '../components/ScreenHeader';
import { SettingsSkeletonList } from '../components/SkeletonShimmer';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import { NEXO_SUPPORT_URL, openNexoPage } from '../lib/brand';
import { hapticLight, hapticToggle, hapticWarning } from '../lib/haptics';
import { useT } from '../lib/i18n';
import {
    fetchModerationCounts,
    type ModerationCounts,
} from '../lib/moderation';
import { Alert } from '../lib/nexoAlert';
import {
    getNotificationCategoryPrefs,
    setNotificationCategoryPrefs,
    syncNotificationCategoryPrefsFromServer,
    type NotificationCategoryPrefs,
} from '../lib/notificationPrefs';
import { ownerActionsVisible, staffActionsVisible } from '../lib/ownerSecretActions';
import { deleteAccount } from '../lib/profile';
import {
    cancelAllScheduledNexoNotifications,
    enablePushWithPermission,
    getNotificationPermissionStatus,
    getPushPreference,
    openSystemNotificationSettings,
    setPushPreference,
    syncPushPreferenceFromServer,
    unregisterPushToken,
} from '../lib/push';
import { fetchAccountAccess } from '../lib/roles';
import { signOutAndClearLocalData } from '../lib/session';
import { type ThemeColors } from '../theme';

type RowProps = {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    color?: string;
    onPress?: () => void;
    right?: React.ReactNode;
    subtitle?: string;
};

const Row = ({ icon, label, color, onPress, right, subtitle }: RowProps) => {
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createSettingsStyles);
    const tint = color ?? colors.text;
    const danger = tint === colors.danger;
    return (
        <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
            <View style={[styles.rowIcon, { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft }]}>
                <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.primary} />
            </View>
            <View style={styles.rowTextCol}>
                <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
                {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
            </View>
            {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} /> : null)}
        </TouchableOpacity>
    );
};

export default function SettingsScreen() {
    const router = useRouter();
    const { t, lang, setLang } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createSettingsStyles);
    const { isGuest, requireAccount } = useAuthSession();
    const [notifications, setNotifications] = useState(true);
    const [catPrefs, setCatPrefs] = useState<NotificationCategoryPrefs>({
        messages: true,
        social: true,
        reminders: true,
    });
    const [settingsReady, setSettingsReady] = useState(false);
    const [osDenied, setOsDenied] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [isStaff, setIsStaff] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [modCounts, setModCounts] = useState<ModerationCounts | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    // Precargar datos al montar el componente (no solo al focus)
    useEffect(() => {
        let alive = true;
        void (async () => {
            const user = await getAuthUser();
            const uid = user?.id ?? null;
            const [pref, access, perm, cats] = await Promise.all([
                uid ? syncPushPreferenceFromServer(uid) : getPushPreference(),
                fetchAccountAccess(),
                getNotificationPermissionStatus(),
                uid ? syncNotificationCategoryPrefsFromServer(uid) : getNotificationCategoryPrefs(),
            ]);
            if (!alive) return;
            setUserId(uid);
            setNotifications(pref && perm !== 'denied');
            setCatPrefs(cats);
            setOsDenied(perm === 'denied');
            setIsStaff(access.isStaff);
            setIsOwner(access.isOwner);
            if (access.isStaff) {
                const counts = await fetchModerationCounts();
                if (alive) setModCounts(counts);
            } else {
                setModCounts(null);
            }
            if (alive) setSettingsReady(true);
        })();
        return () => {
            alive = false;
        };
    }, []);

    // Solo refrescar al focus si ya está listo
    useFocusEffect(
        useCallback(() => {
            if (settingsReady && userId) {
                void (async () => {
                    const [pref, perm, cats] = await Promise.all([
                        syncPushPreferenceFromServer(userId),
                        getNotificationPermissionStatus(),
                        syncNotificationCategoryPrefsFromServer(userId),
                    ]);
                    setNotifications(pref && perm !== 'denied');
                    setCatPrefs(cats);
                    setOsDenied(perm === 'denied');
                })();
            }
        }, [settingsReady, userId]),
    );

    const handleNotificationsToggle = async (value: boolean) => {
        hapticToggle(value);
        if (!value) {
            setNotifications(false);
            await setPushPreference(false, userId ?? undefined);
            return;
        }
        const result = await enablePushWithPermission(userId ?? undefined);
        setNotifications(result.enabled);
        setOsDenied(result.denied);
        if (result.denied) {
            hapticWarning();
            Alert.alert(t('settings.notifPermissionDenied'), t('settings.notifPermissionBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('settings.notifOpenSettings'),
                    onPress: () => {
                        void openSystemNotificationSettings();
                    },
                },
            ]);
        }
    };

    const handleCategoryToggle = async (key: keyof NotificationCategoryPrefs, value: boolean) => {
        hapticToggle(value);
        const next = { ...catPrefs, [key]: value };
        setCatPrefs(next);
        await setNotificationCategoryPrefs(next, userId ?? undefined);
        if (key === 'reminders' && !value) {
            await cancelAllScheduledNexoNotifications();
        }
    };

    const handleLogout = () => {
        hapticLight();
        Alert.alert(t('settings.logout'), t('settings.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.yes'),
                style: 'destructive',
                onPress: async () => {
                    await unregisterPushToken(userId ?? undefined);
                    await signOutAndClearLocalData();
                    router.replace('/login');
                },
            },
        ]);
    };

    const confirmDeleteAccount = () => {
        hapticWarning();
        Alert.alert(t('profile.deleteAccountTitle'), t('profile.deleteAccountMsg'), [
            { text: t('profile.cancel'), style: 'cancel' },
            {
                text: t('profile.deleteAccountConfirm'),
                style: 'destructive',
                onPress: async () => {
                    setDeleting(true);
                    await unregisterPushToken(userId ?? undefined);
                    await cancelAllScheduledNexoNotifications();
                    const { error } = await deleteAccount();
                    setDeleting(false);
                    if (error) {
                        Alert.alert(t('profile.error'), t('profile.deleteAccountError') + (error ? `\n${error}` : ''));
                        return;
                    }
                    router.replace('/login');
                },
            },
        ]);
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScreenHeader compact embedded title={t('settings.title')} onBack={() => router.back()} />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {!settingsReady ? (
                    <SettingsSkeletonList count={9} />
                ) : (
                    <>
                <View style={styles.card}>
                    <Row
                        icon="language-outline"
                        label={t('settings.language')}
                        onPress={undefined}
                        right={<LangPicker lang={lang} onChange={setLang} compact />}
                    />
                    {!isGuest ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="notifications-outline"
                                label={t('settings.notifications')}
                                subtitle={t('settings.notificationsHint')}
                                onPress={undefined}
                                right={
                                    <Switch
                                        value={notifications}
                                        onValueChange={(v) => {
                                            void handleNotificationsToggle(v);
                                        }}
                                        trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                        thumbColor={colors.onPrimary}
                                    />
                                }
                            />
                            {notifications && !osDenied ? (
                                <>
                                    <View style={styles.divider} />
                                    <Row
                                        icon="chatbubbles-outline"
                                        label={t('settings.notifMessages')}
                                        subtitle={t('settings.notifMessagesHint')}
                                        onPress={undefined}
                                        right={
                                            <Switch
                                                value={catPrefs.messages}
                                                onValueChange={(v) => {
                                                    void handleCategoryToggle('messages', v);
                                                }}
                                                trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                                thumbColor={colors.onPrimary}
                                            />
                                        }
                                    />
                                    <View style={styles.divider} />
                                    <Row
                                        icon="people-outline"
                                        label={t('settings.notifSocial')}
                                        subtitle={t('settings.notifSocialHint')}
                                        onPress={undefined}
                                        right={
                                            <Switch
                                                value={catPrefs.social}
                                                onValueChange={(v) => {
                                                    void handleCategoryToggle('social', v);
                                                }}
                                                trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                                thumbColor={colors.onPrimary}
                                            />
                                        }
                                    />
                                    <View style={styles.divider} />
                                    <Row
                                        icon="alarm-outline"
                                        label={t('settings.notifReminders')}
                                        subtitle={t('settings.notifRemindersHint')}
                                        onPress={undefined}
                                        right={
                                            <Switch
                                                value={catPrefs.reminders}
                                                onValueChange={(v) => {
                                                    void handleCategoryToggle('reminders', v);
                                                }}
                                                trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                                thumbColor={colors.onPrimary}
                                            />
                                        }
                                    />
                                </>
                            ) : null}
                            <View style={styles.divider} />
                            <Row icon="ban-outline" label={t('settings.blockedAccounts')} onPress={() => router.push('/blocked-accounts')} />
                        </>
                    ) : null}
                    <View style={styles.divider} />
                    <Row icon="lock-closed-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} />
                    <View style={styles.divider} />
                    <Row icon="people-outline" label={t('settings.communityNorms')} onPress={() => router.push('/community-norms')} />
                    <View style={styles.divider} />
                    <Row icon="shield-checkmark-outline" label={t('settings.terms')} onPress={() => router.push('/terms')} />
                    <View style={styles.divider} />
                    <Row icon="help-circle-outline" label={t('settings.helpCenter')} onPress={() => router.push('/help-center')} />
                    <View style={styles.divider} />
                    <Row
                        icon="mail-outline"
                        label={t('settings.support')}
                        onPress={() => void openNexoPage(NEXO_SUPPORT_URL)}
                    />
                    {ownerActionsVisible(isOwner) ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="stats-chart-outline"
                                label={t('settings.analytics')}
                                onPress={() => router.push('/analytics')}
                            />
                        </>
                    ) : null}
                    {staffActionsVisible(isStaff) ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="shield-outline"
                                label={
                                    modCounts && Math.max(0, modCounts.total - (modCounts.organizadores ?? 0)) > 0
                                        ? `${t('settings.moderation')} (${Math.max(0, modCounts.total - (modCounts.organizadores ?? 0))})`
                                        : t('settings.moderation')
                                }
                                onPress={() => router.push('/admin')}
                            />
                            <View style={styles.divider} />
                            <Row
                                icon="ribbon-outline"
                                label={
                                    modCounts && modCounts.organizadores > 0
                                        ? `${t('settings.organizersInbox')} (${modCounts.organizadores})`
                                        : t('settings.organizersInbox')
                                }
                                onPress={() => router.push('/admin/organizers')}
                            />
                        </>
                    ) : null}
                    {!isGuest ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="ribbon-outline"
                                label={t('settings.organizer')}
                                onPress={() => router.push('/organizer-apply')}
                            />
                        </>
                    ) : (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="person-add-outline"
                                label={t('settings.createAccount')}
                                onPress={() => requireAccount({ type: 'generic' })}
                            />
                        </>
                    )}
                </View>

                {!isGuest ? (
                <View style={[styles.card, { marginTop: 16 }]}>
                    <Row icon="log-out-outline" label={t('settings.logout')} color={colors.danger} onPress={handleLogout} />
                    <View style={styles.divider} />
                    <Row
                        icon="trash-outline"
                        label={deleting ? t('profile.deletingAccount') : t('profile.deleteAccountTitle')}
                        color={colors.danger}
                        onPress={deleting ? undefined : confirmDeleteAccount}
                    />
                </View>
                ) : null}
                    </>
                )}
            </ScrollView>
            </SafeAreaView>
        </View>
    );
}

function createSettingsStyles(c: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.backgroundAlt },
        header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 44, paddingBottom: 14 },
        backButton: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: c.surface, borderRadius: 15, elevation: 3, shadowColor: c.primary, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
        headerTitle: { fontSize: 22, fontWeight: '900', color: c.text },
        content: { paddingHorizontal: 20, paddingBottom: 40 },
        loadingCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
        card: { backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
        row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
        rowIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
        rowTextCol: { flex: 1 },
        rowLabel: { fontSize: 16, fontWeight: '600' },
        rowSub: { marginTop: 3, fontSize: 12, fontWeight: '500', color: c.textSubtle, lineHeight: 16 },
        divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 68 },
    });
}
