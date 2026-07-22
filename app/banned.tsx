import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../lib/i18n';
import { supabase } from '../lib/supabase';

const INK = '#0F2A4A';
const MUTED = '#64748B';
const DANGER = '#DC2626';

export default function BannedScreen() {
    const { t } = useT();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const logout = async () => {
        await supabase.auth.signOut();
        router.replace('/login');
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
            <LinearGradient colors={['#FEE2E2', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <View style={styles.card}>
                <View style={styles.iconWrap}>
                    <Ionicons name="ban" size={36} color={DANGER} />
                </View>
                <Text style={styles.title}>{t('banned.title')}</Text>
                <Text style={styles.body}>{t('banned.body')}</Text>
                <TouchableOpacity style={styles.btn} onPress={logout} activeOpacity={0.85}>
                    <Text style={styles.btnText}>{t('banned.logout')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 28,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    iconWrap: {
        width: 72,
        height: 72,
        borderRadius: 22,
        backgroundColor: '#FEE2E2',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 18,
    },
    title: { fontSize: 22, fontWeight: '900', color: INK, textAlign: 'center' },
    body: { fontSize: 15, color: MUTED, textAlign: 'center', marginTop: 10, lineHeight: 22 },
    btn: {
        marginTop: 24,
        backgroundColor: INK,
        paddingHorizontal: 22,
        paddingVertical: 14,
        borderRadius: 14,
        alignSelf: 'stretch',
        alignItems: 'center',
    },
    btnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
