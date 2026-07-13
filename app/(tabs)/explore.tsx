import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '../../lib/i18n';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

export default function ExploreScreen() {
    const router = useRouter();
    const { t } = useT();

    const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }[] = [
        { icon: 'map', title: t('explore.feat1Title'), desc: t('explore.feat1Desc') },
        { icon: 'people', title: t('explore.feat2Title'), desc: t('explore.feat2Desc') },
        { icon: 'chatbubbles', title: t('explore.feat3Title'), desc: t('explore.feat3Desc') },
    ];

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF']} style={StyleSheet.absoluteFill} />

            <View style={styles.header}>
                <Text style={styles.title}>{t('explore.title')}</Text>
                <Text style={styles.subtitle}>{t('explore.subtitle')}</Text>
            </View>

            <View style={styles.cards}>
                {FEATURES.map((f) => (
                    <View key={f.title} style={styles.card}>
                        <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.iconWrap}>
                            <Ionicons name={f.icon} size={24} color="#FFF" />
                        </LinearGradient>
                        <View style={styles.cardText}>
                            <Text style={styles.cardTitle}>{f.title}</Text>
                            <Text style={styles.cardDesc}>{f.desc}</Text>
                        </View>
                    </View>
                ))}
            </View>

            <TouchableOpacity style={styles.cta} activeOpacity={0.9} onPress={() => router.push('/(tabs)')}>
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.ctaGradient}>
                    <Text style={styles.ctaText}>{t('explore.cta')}</Text>
                    <Ionicons name="arrow-forward" size={20} color="#FFF" />
                </LinearGradient>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F7FF', paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 80 : 64 },
    header: { marginBottom: 28 },
    title: { fontSize: 34, fontWeight: '900', color: INK, letterSpacing: -0.5 },
    subtitle: { fontSize: 16, color: '#64748B', fontWeight: '600', marginTop: 4 },
    cards: { gap: 14 },
    card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 22, padding: 16, elevation: 5, shadowColor: '#1E3A8A', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
    iconWrap: { width: 52, height: 52, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
    cardText: { flex: 1, marginLeft: 16 },
    cardTitle: { fontSize: 17, fontWeight: '800', color: INK },
    cardDesc: { fontSize: 13, color: '#64748B', marginTop: 3, lineHeight: 18 },
    cta: { marginTop: 36, borderRadius: 18, overflow: 'hidden', elevation: 6, shadowColor: PRIMARY_DARK, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    ctaGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
    ctaText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});
