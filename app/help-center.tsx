import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
    LayoutAnimation,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../lib/i18n';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

type HelpItem = {
    icon: keyof typeof Ionicons.glyphMap;
    titleKey: string;
    descKey: string;
    section: 'gettingStarted' | 'safetyReports' | 'feedback';
    action?: 'mailto';
    accent: string;
    expandable?: boolean;
};

const ITEMS: HelpItem[] = [
    { icon: 'compass-outline', titleKey: 'help.howNexo.title', descKey: 'help.howNexo.desc', section: 'gettingStarted', accent: PRIMARY_DARK, expandable: true },
    { icon: 'add-circle-outline', titleKey: 'help.createPlan.title', descKey: 'help.createPlan.desc', section: 'gettingStarted', accent: '#10B981', expandable: true },
    { icon: 'star-outline', titleKey: 'help.ratings.title', descKey: 'help.ratings.desc', section: 'gettingStarted', accent: '#F59E0B', expandable: true },
    { icon: 'alert-circle-outline', titleKey: 'help.reportProblem.title', descKey: 'help.reportProblem.desc', section: 'safetyReports', accent: '#EF4444', action: 'mailto' },
    { icon: 'flag-outline', titleKey: 'help.reportUser.title', descKey: 'help.reportUser.desc', section: 'safetyReports', accent: '#DC2626', action: 'mailto' },
    { icon: 'bulb-outline', titleKey: 'help.idea.title', descKey: 'help.idea.desc', section: 'feedback', accent: '#8B5CF6', action: 'mailto' },
];

const SECTIONS = [
    { key: 'gettingStarted' as const, labelKey: 'help.gettingStarted', icon: 'rocket-outline' as const },
    { key: 'safetyReports' as const, labelKey: 'help.safetyReports', icon: 'shield-outline' as const },
    { key: 'feedback' as const, labelKey: 'help.feedback', icon: 'chatbubble-ellipses-outline' as const },
];

export default function HelpCenterScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return ITEMS;
        return ITEMS.filter(
            (item) =>
                t(item.titleKey).toLowerCase().includes(q) ||
                t(item.descKey).toLowerCase().includes(q),
        );
    }, [query, t]);

    const toggleExpand = (key: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handlePress = (item: HelpItem) => {
        if (item.expandable) {
            toggleExpand(item.titleKey);
            return;
        }
        if (item.action === 'mailto') {
            Linking.openURL('mailto:soporte@nexo.app?subject=' + encodeURIComponent(t(item.titleKey)));
        }
    };

    const openContact = () => {
        Linking.openURL('mailto:soporte@nexo.app?subject=' + encodeURIComponent(t('help.contactTitle')));
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#F8FAFC']} style={StyleSheet.absoluteFill} />

            <ScreenHeader title={t('settings.helpCenter')} onBack={() => router.back()} />

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
                    <View style={styles.heroIconWrap}>
                        <Ionicons name="help-buoy" size={28} color="#FFF" />
                    </View>
                    <Text style={styles.heroTitle}>{t('help.heroTitle')}</Text>
                    <Text style={styles.heroSub}>{t('help.intro')}</Text>
                </LinearGradient>

                <View style={styles.searchWrap}>
                    <Ionicons name="search" size={18} color={MUTED} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t('help.searchPlaceholder')}
                        placeholderTextColor="#94A3B8"
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {query.length > 0 ? (
                        <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close-circle" size={18} color="#CBD5E1" />
                        </TouchableOpacity>
                    ) : null}
                </View>

                {SECTIONS.map((section) => {
                    const items = filtered.filter((i) => i.section === section.key);
                    if (items.length === 0) return null;

                    return (
                        <View key={section.key} style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Ionicons name={section.icon} size={16} color={PRIMARY_DARK} />
                                <Text style={styles.sectionTitle}>{t(section.labelKey)}</Text>
                            </View>

                            <View style={styles.sectionCard}>
                                {items.map((item, idx) => {
                                    const isExpanded = !!expanded[item.titleKey];
                                    const isLast = idx === items.length - 1;

                                    return (
                                        <TouchableOpacity
                                            key={item.titleKey}
                                            style={[styles.itemRow, !isLast && styles.itemRowBorder]}
                                            activeOpacity={0.85}
                                            onPress={() => handlePress(item)}
                                        >
                                            <View style={[styles.itemAccent, { backgroundColor: item.accent }]} />
                                            <View style={[styles.itemIcon, { backgroundColor: `${item.accent}14` }]}>
                                                <Ionicons name={item.icon} size={20} color={item.accent} />
                                            </View>
                                            <View style={styles.itemBody}>
                                                <Text style={styles.itemTitle}>{t(item.titleKey)}</Text>
                                                {item.expandable && isExpanded ? (
                                                    <Text style={styles.itemDesc}>{t(item.descKey)}</Text>
                                                ) : !item.expandable ? (
                                                    <Text style={styles.itemDesc} numberOfLines={2}>{t(item.descKey)}</Text>
                                                ) : null}
                                            </View>
                                            <Ionicons
                                                name={
                                                    item.expandable
                                                        ? isExpanded
                                                            ? 'chevron-up'
                                                            : 'chevron-down'
                                                        : 'chevron-forward'
                                                }
                                                size={18}
                                                color="#CBD5E1"
                                            />
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}

                {filtered.length === 0 ? (
                    <View style={styles.empty}>
                        <Ionicons name="search-outline" size={40} color="#CBD5E1" />
                        <Text style={styles.emptyText}>{t('help.noResults')}</Text>
                    </View>
                ) : null}

                <TouchableOpacity style={styles.contactCard} activeOpacity={0.9} onPress={openContact}>
                    <LinearGradient colors={['#EFF6FF', '#FFF']} style={styles.contactGradient}>
                        <View style={styles.contactIcon}>
                            <Ionicons name="mail-open-outline" size={24} color={PRIMARY_DARK} />
                        </View>
                        <View style={styles.contactBody}>
                            <Text style={styles.contactTitle}>{t('help.contactTitle')}</Text>
                            <Text style={styles.contactDesc}>{t('help.contactDesc')}</Text>
                        </View>
                        <View style={styles.contactBtn}>
                            <Text style={styles.contactBtnText}>{t('help.contactBtn')}</Text>
                            <Ionicons name="arrow-forward" size={16} color="#FFF" />
                        </View>
                    </LinearGradient>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { paddingHorizontal: 20 },
    heroCard: {
        borderRadius: 22,
        padding: 22,
        marginBottom: 18,
        overflow: 'hidden',
    },
    heroIconWrap: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
    },
    heroTitle: { fontSize: 22, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },
    heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.88)', marginTop: 6, lineHeight: 20 },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 14 : 10,
        gap: 10,
        marginBottom: 22,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
    },
    searchInput: { flex: 1, fontSize: 15, fontWeight: '600', color: INK },
    section: { marginBottom: 20 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 4 },
    sectionTitle: { fontSize: 13, fontWeight: '800', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
    sectionCard: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E8EEF5',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
    },
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingRight: 14, gap: 12 },
    itemRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    itemAccent: { width: 4, alignSelf: 'stretch', borderTopLeftRadius: 2, borderBottomLeftRadius: 2 },
    itemIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    itemBody: { flex: 1 },
    itemTitle: { fontSize: 15, fontWeight: '800', color: INK },
    itemDesc: { fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 19 },
    empty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
    emptyText: { fontSize: 14, fontWeight: '600', color: MUTED },
    contactCard: { marginTop: 8, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: '#DBEAFE' },
    contactGradient: { padding: 20, gap: 14 },
    contactIcon: {
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
    },
    contactBody: { gap: 4 },
    contactTitle: { fontSize: 17, fontWeight: '900', color: INK },
    contactDesc: { fontSize: 13, color: MUTED, lineHeight: 19 },
    contactBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        backgroundColor: PRIMARY_DARK,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
    },
    contactBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
