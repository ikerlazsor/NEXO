import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useState } from 'react';
import {
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
import { fetchAccountAccess } from '../lib/roles';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const DANGER = '#EF4444';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

type RowProps = {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    color?: string;
    onPress?: () => void;
    right?: React.ReactNode;
};

const Row = ({ icon, label, color = INK, onPress, right }: RowProps) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
        <View style={[styles.rowIcon, { backgroundColor: color === DANGER ? '#FEE2E2' : '#EFF6FF' }]}>
            <Ionicons name={icon} size={20} color={color === DANGER ? DANGER : PRIMARY_DARK} />
        </View>
        <Text style={[styles.rowLabel, { color }]}>{label}</Text>
        {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color="#CBD5E1" /> : null)}
    </TouchableOpacity>
);

export default function SettingsScreen() {
    const router = useRouter();
    const { t, lang, setLang } = useT();
    const [notifications, setNotifications] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [isStaff, setIsStaff] = useState(false);
    const [modCounts, setModCounts] = useState<ModerationCounts | null>(null);

    useFocusEffect(
        useCallback(() => {
            let alive = true;
            void (async () => {
                const access = await fetchAccountAccess();
                if (!alive) return;
                setIsStaff(access.isStaff);
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
        }, []),
    );

    const handleLogout = () => {
        Alert.alert(t('settings.logout'), t('settings.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.yes'), style: 'destructive', onPress: async () => { await supabase.auth.signOut(); router.replace('/login'); } },
        ]);
    };

    const confirmDeleteAccount = () => {
        Alert.alert(t('profile.deleteAccountTitle'), t('profile.deleteAccountMsg'), [
            { text: t('profile.cancel'), style: 'cancel' },
            {
                text: t('profile.deleteAccountConfirm'),
                style: 'destructive',
                onPress: async () => {
                    setDeleting(true);
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
                <View style={styles.card}>
                    <Row
                        icon="language-outline"
                        label={t('settings.language')}
                        onPress={undefined}
                        right={<LangPicker lang={lang} onChange={setLang} compact />}
                    />
                    <View style={styles.divider} />
                    <Row
                        icon="notifications-outline"
                        label={t('settings.notifications')}
                        onPress={undefined}
                        right={<Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: PRIMARY, false: '#CBD5E1' }} thumbColor="#FFF" />}
                    />
                    <View style={styles.divider} />
                    <Row icon="ban-outline" label={t('settings.blockedAccounts')} onPress={() => router.push('/blocked-accounts')} />
                    <View style={styles.divider} />
                    <Row icon="diamond-outline" label={t('settings.nexoPlus')} onPress={() => router.push('/nexo-plus')} />
                    <View style={styles.divider} />
                    <Row icon="lock-closed-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} />
                    <View style={styles.divider} />
                    <Row icon="shield-checkmark-outline" label={t('settings.terms')} onPress={() => router.push('/terms')} />
                    <View style={styles.divider} />
                    <Row icon="help-circle-outline" label={t('settings.helpCenter')} onPress={() => router.push('/help-center')} />
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
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 44, paddingBottom: 14 },
    backButton: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    headerTitle: { fontSize: 22, fontWeight: '900', color: INK },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    card: { backgroundColor: '#FFF', borderRadius: 20, overflow: 'hidden', elevation: 3, shadowColor: '#1E3A8A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
    rowIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    rowLabel: { flex: 1, fontSize: 16, fontWeight: '600' },
    divider: { height: 1, backgroundColor: '#F1F5F9', marginLeft: 68 },
});
