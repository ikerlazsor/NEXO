import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { LangPicker } from '../components/LangPicker';
import { useT } from '../lib/i18n';
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
    const [showDistance, setShowDistance] = useState(true);

    const soon = () => Alert.alert(t('settings.soon'), t('settings.soonMsg'));

    const handleLogout = () => {
        Alert.alert(t('settings.logout'), t('settings.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.yes'), style: 'destructive', onPress: async () => { await supabase.auth.signOut(); router.replace('/login'); } },
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
                <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
                <View style={styles.card}>
                    <Row icon="person-outline" label={t('settings.editProfile')} onPress={() => router.push('/profile')} />
                    <View style={styles.divider} />
                    <Row icon="people-outline" label={t('settings.myFriends')} onPress={() => router.push('/friends')} />
                    <View style={styles.divider} />
                    <Row icon="heart-outline" label={t('settings.savedPlans')} onPress={() => router.push('/saved-plans')} />
                </View>

                <Text style={styles.sectionTitle}>{t('settings.preferences')}</Text>
                <View style={styles.card}>
                    <Row
                        icon="notifications-outline"
                        label={t('settings.notifications')}
                        onPress={undefined}
                        right={<Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: PRIMARY, false: '#CBD5E1' }} thumbColor="#FFF" />}
                    />
                    <View style={styles.divider} />
                    <Row
                        icon="location-outline"
                        label={t('settings.showDistance')}
                        onPress={undefined}
                        right={<Switch value={showDistance} onValueChange={setShowDistance} trackColor={{ true: PRIMARY, false: '#CBD5E1' }} thumbColor="#FFF" />}
                    />
                    <View style={styles.divider} />
                    <Row
                        icon="language-outline"
                        label={t('settings.language')}
                        onPress={undefined}
                        right={<LangPicker lang={lang} onChange={setLang} compact />}
                    />
                </View>

                <Text style={styles.sectionTitle}>{t('settings.privacyHelp')}</Text>
                <View style={styles.card}>
                    <Row icon="lock-closed-outline" label={t('settings.privacy')} onPress={soon} />
                    <View style={styles.divider} />
                    <Row icon="shield-checkmark-outline" label={t('settings.terms')} onPress={soon} />
                    <View style={styles.divider} />
                    <Row icon="help-circle-outline" label={t('settings.helpCenter')} onPress={soon} />
                </View>

                <View style={styles.card}>
                    <Row icon="log-out-outline" label={t('settings.logout')} color={DANGER} onPress={handleLogout} />
                </View>

                <Text style={styles.version}>{t('settings.version')}</Text>
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
    sectionTitle: { fontSize: 12, fontWeight: '800', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 10, marginLeft: 6 },
    card: { backgroundColor: '#FFF', borderRadius: 20, overflow: 'hidden', elevation: 3, shadowColor: '#1E3A8A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
    rowIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    rowLabel: { flex: 1, fontSize: 16, fontWeight: '600' },
    divider: { height: 1, backgroundColor: '#F1F5F9', marginLeft: 68 },
    version: { textAlign: 'center', color: '#94A3B8', fontSize: 12, marginTop: 28, fontWeight: '600' },
    langToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 2 },
    langOption: { width: 38, height: 32, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
    langOptionActive: { backgroundColor: '#FFF', elevation: 2, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    langFlag: { fontSize: 18 },
});
