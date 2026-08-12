import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useState } from 'react';
import {
    ActivityIndicator,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { LangPicker } from '../components/LangPicker';
import { useT } from '../lib/i18n';
import {
    fetchModerationCounts,
    type ModerationCounts,
} from '../lib/moderation';
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
import { hapticLight, hapticToggle, hapticWarning } from '../lib/haptics';
import { fetchAccountAccess } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { signOutAndClearLocalData } from '../lib/session';
import { theme } from '../theme';

const PRIMARY = theme.colors.brand;
const PRIMARY_DARK = theme.colors.primary;
const INK = theme.colors.text;
const DANGER = theme.colors.danger;
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = theme.colors.backgroundAlt;

type RowProps = {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    color?: string;
    onPress?: () => void;
    right?: React.ReactNode;
    subtitle?: string;
};

const Row = ({ icon, label, color = INK, onPress, right, subtitle }: RowProps) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
        <View style={[styles.rowIcon, { backgroundColor: color === DANGER ? '#FEE2E2' : theme.colors.primarySoft }]}>
            <Ionicons name={icon} size={20} color={color === DANGER ? DANGER : PRIMARY_DARK} />
        </View>
        <View style={styles.rowTextCol}>
            <Text style={[styles.rowLabel, { color }]}>{label}</Text>
            {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        </View>
        {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color="#CBD5E1" /> : null)}
    </TouchableOpacity>
);

export default function SettingsScreen() {
    const router = useRouter();
    const { t, lang, setLang } = useT();
    const [notifications, setNotifications] = useState(true);
    const [settingsReady, setSettingsReady] = useState(false);
    const [osDenied, setOsDenied] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [isStaff, setIsStaff] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [modCounts, setModCounts] = useState<ModerationCounts | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    useFocusEffect(
        useCallback(() => {
            let alive = true;
            setSettingsReady(false);
            void (async () => {
                const { data } = await supabase.auth.getUser();
                const uid = data.user?.id ?? null;
                const [pref, access, perm] = await Promise.all([
                    uid ? syncPushPreferenceFromServer(uid) : getPushPreference(),
                    fetchAccountAccess(),
                    getNotificationPermissionStatus(),
                ]);
                if (!alive) return;
                setUserId(uid);
                setNotifications(pref && perm !== 'denied');
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
        }, []),
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
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('settings.title')}</Text>
                <View style={{ width: 45 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {!settingsReady ? (
                    <View style={styles.loadingCard}>
                        <ActivityIndicator size="small" color={PRIMARY_DARK} />
                    </View>
                ) : (
                    <>
                <View style={styles.card}>
                    <Row
                        icon="language-outline"
                        label={t('settings.language')}
                        onPress={undefined}
                        right={<LangPicker lang={lang} onChange={setLang} compact />}
                    />
                </View>

                <View style={[styles.card, { marginTop: 16 }]}>
                    <Row
                        icon="notifications-outline"
                        label={t('settings.notifications')}
                        subtitle={osDenied ? t('settings.notifPermissionBody') : t('settings.notificationsHint')}
                        onPress={undefined}
                        right={
                            <Switch
                                value={notifications}
                                onValueChange={(v) => {
                                    void handleNotificationsToggle(v);
                                }}
                                trackColor={{ true: PRIMARY, false: '#CBD5E1' }}
                                thumbColor={theme.colors.surface}
                            />
                        }
                    />
                </View>

                <View style={[styles.card, { marginTop: 16 }]}>
                    <Row icon="ban-outline" label={t('settings.blockedAccounts')} onPress={() => router.push('/blocked-accounts')} />
                    <View style={styles.divider} />
                    <Row icon="lock-closed-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} />
                    <View style={styles.divider} />
                    <Row icon="people-outline" label={t('settings.communityNorms')} onPress={() => router.push('/community-norms')} />
                    <View style={styles.divider} />
                    <Row icon="shield-checkmark-outline" label={t('settings.terms')} onPress={() => router.push('/terms')} />
                    <View style={styles.divider} />
                    <Row icon="help-circle-outline" label={t('settings.helpCenter')} onPress={() => router.push('/help-center')} />
                    {isOwner ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="stats-chart-outline"
                                label={t('settings.analytics')}
                                onPress={() => router.push('/analytics')}
                            />
                        </>
                    ) : null}
                    {isStaff ? (
                        <>
                            <View style={styles.divider} />
                            <Row
                                icon="shield-outline"
                                label={
                                    modCounts && modCounts.total > 0
                                        ? `${t('settings.moderation')} (${modCounts.total})`
                                        : t('settings.moderation')
                                }
                                onPress={() => router.push('/admin')}
                            />
                        </>
                    ) : null}
                </View>

                <View style={[styles.card, { marginTop: 16 }]}>
                    <Row icon="log-out-outline" label={t('settings.logout')} color={DANGER} onPress={handleLogout} />
                    <View style={styles.divider} />
                    <Row
                        icon="trash-outline"
                        label={deleting ? t('profile.deletingAccount') : t('profile.deleteAccountTitle')}
                        color={DANGER}
                        onPress={deleting ? undefined : confirmDeleteAccount}
                    />
                </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 44, paddingBottom: 14 },
    backButton: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    headerTitle: { fontSize: 22, fontWeight: '900', color: INK },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    loadingCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden', elevation: 3, shadowColor: '#1E3A8A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
    rowIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    rowTextCol: { flex: 1 },
    rowLabel: { fontSize: 16, fontWeight: '600' },
    rowSub: { marginTop: 3, fontSize: 12, fontWeight: '500', color: theme.colors.textSubtle, lineHeight: 16 },
    divider: { height: 1, backgroundColor: theme.colors.surfaceSubtle, marginLeft: 68 },
});
