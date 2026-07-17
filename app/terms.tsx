import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../lib/i18n';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

const SECTIONS = [
    { key: 'terms.acceptance', icon: 'document-text-outline' as const, color: PRIMARY_DARK },
    { key: 'terms.service', icon: 'people-outline' as const, color: '#10B981' },
    { key: 'terms.accounts', icon: 'person-circle-outline' as const, color: '#8B5CF6' },
    { key: 'terms.plans', icon: 'calendar-outline' as const, color: '#F59E0B' },
    { key: 'terms.conduct', icon: 'shield-checkmark-outline' as const, color: '#EF4444' },
    { key: 'terms.privacy', icon: 'lock-closed-outline' as const, color: '#06B6D4' },
    { key: 'terms.liability', icon: 'alert-circle-outline' as const, color: '#64748B' },
    { key: 'terms.changes', icon: 'refresh-outline' as const, color: '#6366F1' },
];

export default function TermsScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);
    const docCardOffset = useRef(0);
    const sectionOffsets = useRef<Record<string, number>>({});
    const [activeSection, setActiveSection] = useState(SECTIONS[0].key);

    const scrollToSection = (key: string) => {
        setActiveSection(key);
        const y = sectionOffsets.current[key];
        if (y != null) {
            scrollRef.current?.scrollTo({ y: Math.max(0, docCardOffset.current + y - 16), animated: true });
        }
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#F8FAFC']} style={StyleSheet.absoluteFill} />

            <ScreenHeader title={t('settings.terms')} onBack={() => router.back()} subtitle={t('terms.updated')} />

            <ScrollView
                ref={scrollRef}
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
                stickyHeaderIndices={[0]}
            >
                <View style={styles.tocSticky}>
                    <Text style={styles.tocLabel}>{t('terms.toc')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tocRow}>
                        {SECTIONS.map((s, i) => (
                            <TouchableOpacity
                                key={s.key}
                                style={[styles.tocChip, activeSection === s.key && styles.tocChipActive]}
                                onPress={() => scrollToSection(s.key)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.tocChipNum, activeSection === s.key && styles.tocChipNumActive]}>
                                    {i + 1}
                                </Text>
                                <Text style={[styles.tocChipText, activeSection === s.key && styles.tocChipTextActive]} numberOfLines={1}>
                                    {t(`${s.key}.title`)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                <View
                    style={styles.docCard}
                    onLayout={(e) => {
                        docCardOffset.current = e.nativeEvent.layout.y;
                    }}
                >
                    <View style={styles.docHeader}>
                        <View style={styles.docBadge}>
                            <Ionicons name="shield-checkmark" size={20} color={PRIMARY_DARK} />
                        </View>
                        <View style={styles.docHeaderText}>
                            <Text style={styles.docTitle}>{t('settings.terms')}</Text>
                            <Text style={styles.docUpdated}>{t('terms.updated')}</Text>
                        </View>
                    </View>

                    <View style={styles.introBox}>
                        <Ionicons name="information-circle-outline" size={20} color={PRIMARY_DARK} />
                        <Text style={styles.intro}>{t('terms.intro')}</Text>
                    </View>

                    {SECTIONS.map((section, i) => (
                        <View
                            key={section.key}
                            style={styles.section}
                            onLayout={(e) => {
                                sectionOffsets.current[section.key] = e.nativeEvent.layout.y;
                            }}
                        >
                            <View style={styles.sectionHead}>
                                <View style={[styles.sectionNum, { backgroundColor: `${section.color}18` }]}>
                                    <Text style={[styles.sectionNumText, { color: section.color }]}>{i + 1}</Text>
                                </View>
                                <View style={[styles.sectionIcon, { backgroundColor: `${section.color}14` }]}>
                                    <Ionicons name={section.icon} size={18} color={section.color} />
                                </View>
                                <Text style={styles.sectionTitle}>{t(`${section.key}.title`)}</Text>
                            </View>
                            <Text style={styles.sectionBody}>{t(`${section.key}.body`)}</Text>
                        </View>
                    ))}
                </View>

                <TouchableOpacity
                    style={styles.contactCard}
                    activeOpacity={0.85}
                    onPress={() => Linking.openURL('mailto:legal@nexo.app')}
                >
                    <Ionicons name="mail-outline" size={22} color={PRIMARY_DARK} />
                    <View style={styles.contactText}>
                        <Text style={styles.contactTitle}>{t('terms.questions')}</Text>
                        <Text style={styles.contactDesc}>{t('terms.questionsDesc')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { paddingHorizontal: 20 },
    tocSticky: {
        backgroundColor: 'transparent',
        paddingBottom: 14,
    },
    tocLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 10,
        paddingHorizontal: 2,
    },
    tocRow: { gap: 8, paddingRight: 4 },
    tocChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        maxWidth: 180,
    },
    tocChipActive: {
        backgroundColor: PRIMARY_DARK,
        borderColor: PRIMARY_DARK,
    },
    tocChipNum: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
        textAlign: 'center',
        lineHeight: 20,
        fontSize: 11,
        fontWeight: '900',
        color: PRIMARY_DARK,
        overflow: 'hidden',
    },
    tocChipNumActive: { backgroundColor: 'rgba(255,255,255,0.25)', color: '#FFF' },
    tocChipText: { fontSize: 12, fontWeight: '700', color: INK, flexShrink: 1 },
    tocChipTextActive: { color: '#FFF' },
    docCard: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 22,
        borderWidth: 1,
        borderColor: '#E8EEF5',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.06,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
    },
    docHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
    docBadge: {
        width: 48,
        height: 48,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    docHeaderText: { flex: 1 },
    docTitle: { fontSize: 20, fontWeight: '900', color: INK, letterSpacing: -0.3 },
    docUpdated: { fontSize: 12, fontWeight: '600', color: MUTED, marginTop: 2 },
    introBox: {
        flexDirection: 'row',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        padding: 14,
        marginBottom: 22,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    intro: { flex: 1, fontSize: 14, color: MUTED, lineHeight: 21 },
    section: {
        paddingTop: 18,
        paddingBottom: 18,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    sectionNum: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    sectionNumText: { fontSize: 13, fontWeight: '900' },
    sectionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    sectionTitle: { flex: 1, fontSize: 16, fontWeight: '900', color: INK },
    sectionBody: { fontSize: 14, color: MUTED, lineHeight: 22, paddingLeft: 2 },
    contactCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 18,
        marginTop: 18,
        borderWidth: 1,
        borderColor: '#E8EEF5',
    },
    contactText: { flex: 1 },
    contactTitle: { fontSize: 15, fontWeight: '800', color: INK },
    contactDesc: { fontSize: 12, color: MUTED, marginTop: 2 },
});
