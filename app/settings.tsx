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
    useEffect,
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
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import { NEXO_SUPPORT_URL, openNexoPage } from '../lib/brand';
import { hapticLight, hapticWarning } from '../lib/haptics';
import { useT } from '../lib/i18n';
import {
    fetchModerationCounts,
    type ModerationCounts,
} from '../lib/moderation';
import { Alert } from '../lib/nexoAlert';
import { ownerActionsVisible, staffActionsVisible } from '../lib/ownerSecretActions';
import { deleteAccount } from '../lib/profile';
import {
    cancelAllScheduledNexoNotifications,
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
                <Text style={[styles.rowLabel, { color: tint }]} numberOfLines={1}>
                    {label}
                </Text>
                {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
            </View>
            {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} /> : null)}
        </TouchableOpacity>
    );
};

export default function SettingsScreen() {
    const router = useRouter();
    const { t } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createSettingsStyles);
    const { isGuest } = useAuthSession();
    const [loggingOut, setLoggingOut] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [isStaff, setIsStaff] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [modCounts, setModCounts] = useState<ModerationCounts | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    // Roles en segundo plano; la UI no espera (antes skeleton bloqueaba).
    useEffect(() => {
        let alive = true;
        void (async () => {
            const user = await getAuthUser();
            const uid = user?.id ?? null;
            if (!alive) return;
            setUserId(uid);
            const access = await fetchAccountAccess();
            if (!alive) return;
            setIsStaff(access.isStaff);
            setIsOwner(access.isOwner);
            if (access.isStaff) {
                const counts = await fetchModerationCounts();
                if (alive) setModCounts(counts);
            } else {
                setModCounts(null);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    useFocusEffect(
        useCallback(() => {
            if (!userId) return;
            void (async () => {
                const access = await fetchAccountAccess();
                setIsStaff(access.isStaff);
                setIsOwner(access.isOwner);
                if (access.isStaff) {
                    setModCounts(await fetchModerationCounts());
                }
            })();
        }, [userId]),
    );

    const handleLogout = () => {
        if (loggingOut) return;
        hapticLight();
        Alert.alert(t('settings.logout'), t('settings.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.yes'),
                style: 'destructive',
                onPress: async () => {
                    setLoggingOut(true);
                    try {
                        await unregisterPushToken(userId ?? undefined);
                        await signOutAndClearLocalData();
                        router.replace('/login');
                    } catch {
                        setLoggingOut(false);
                    }
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
                    const { error } = await deleteAccount({ confirm: true });
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
                <View style={styles.card}>
                    <Row
                        icon="language-outline"
                        label={t('settings.language')}
                        onPress={() => router.push('/language')}
                    />
                    {!isGuest ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="notifications-outline"
                                label={t('settings.notifications')}
                                onPress={() => router.push('/notification-settings')}
                            />
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
                                    modCounts
                                        ? `${t('settings.moderation')} (${modCounts.total})`
                                        : t('settings.moderation')
                                }
                                onPress={() => router.push('/admin')}
                            />
                        </>
                    ) : null}
                </View>

                {!isGuest ? (
                <View style={[styles.card, { marginTop: 16 }]}>
                    <Row
                        icon="log-out-outline"
                        label={loggingOut ? t('settings.loggingOut') : t('settings.logout')}
                        color={colors.danger}
                        onPress={loggingOut ? undefined : handleLogout}
                    />
                    <View style={styles.divider} />
                    <Row
                        icon="trash-outline"
                        label={deleting ? t('profile.deletingAccount') : t('profile.deleteAccountTitle')}
                        color={colors.danger}
                        onPress={deleting ? undefined : confirmDeleteAccount}
                    />
                </View>
                ) : null}
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
        card: { backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
        row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
        rowIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
        rowTextCol: { flex: 1, minWidth: 0 },
        rowLabel: { fontSize: 16, fontWeight: '600' },
        rowSub: { marginTop: 3, fontSize: 12, fontWeight: '500', color: c.textSubtle, lineHeight: 16 },
        divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 68 },
    });
}
