import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { markCommunityNormsSeen } from '../lib/firstRun';
import { useT } from '../lib/i18n';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

const RULES = [
    { icon: 'heart-outline' as const, key: 'norms.r1' },
    { icon: 'person-outline' as const, key: 'norms.r2' },
    { icon: 'people-outline' as const, key: 'norms.r3' },
    { icon: 'shield-checkmark-outline' as const, key: 'norms.r4' },
    { icon: 'flag-outline' as const, key: 'norms.r5' },
];

export default function CommunityNormsScreen() {
    const router = useRouter();
    const { t } = useT();

    useEffect(() => {
        void markCommunityNormsSeen();
    }, []);

    return (
        <View style={styles.root}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={12}>
                        <Ionicons name="chevron-back" size={24} color={INK} />
                    </TouchableOpacity>
                    <Text style={styles.title}>{t('norms.title')}</Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    <Text style={styles.lead}>{t('norms.lead')}</Text>

                    {RULES.map((r) => (
                        <View key={r.key} style={styles.card}>
                            <View style={styles.iconWrap}>
                                <Ionicons name={r.icon} size={22} color={PRIMARY_DARK} />
                            </View>
                            <Text style={styles.rule}>{t(r.key)}</Text>
                        </View>
                    ))}

                    <Text style={styles.footnote}>{t('norms.footnote')}</Text>

                    <TouchableOpacity
                        style={styles.cta}
                        activeOpacity={0.9}
                        onPress={() => router.back()}
                    >
                        <Text style={styles.ctaText}>{t('norms.ok')}</Text>
                    </TouchableOpacity>
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    back: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: { fontSize: 18, fontWeight: '800', color: INK },
    content: { padding: 20, paddingBottom: 40, gap: 12 },
    lead: { fontSize: 15, lineHeight: 22, color: MUTED, marginBottom: 8 },
    card: {
        flexDirection: 'row',
        gap: 12,
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    iconWrap: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rule: { flex: 1, fontSize: 15, lineHeight: 21, color: INK, fontWeight: '600' },
    footnote: { fontSize: 13, lineHeight: 19, color: MUTED, marginTop: 8 },
    cta: {
        marginTop: 12,
        backgroundColor: PRIMARY,
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: 'center',
    },
    ctaText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});
