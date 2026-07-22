import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
    LayoutAnimation,
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

const INK = '#0F2A4A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const BG = '#F8FAFC';
const CARD = '#FFFFFF';
const ACCENT = '#2563EB';

type SupportTipo = 'contacto' | 'problema' | 'idea' | 'denuncia_general';

type FaqItem = {
    id: string;
    titleKey: string;
    bodyKey: string;
    section: 'basics' | 'plans' | 'social' | 'account' | 'safety';
};

type ActionItem = {
    id: string;
    titleKey: string;
    descKey: string;
    supportTipo: SupportTipo;
};

const FAQ: FaqItem[] = [
    { id: 'what', titleKey: 'help.faq.what.title', bodyKey: 'help.faq.what.body', section: 'basics' },
    { id: 'feed', titleKey: 'help.faq.feed.title', bodyKey: 'help.faq.feed.body', section: 'basics' },
    { id: 'create', titleKey: 'help.faq.create.title', bodyKey: 'help.faq.create.body', section: 'plans' },
    { id: 'visibility', titleKey: 'help.faq.visibility.title', bodyKey: 'help.faq.visibility.body', section: 'plans' },
    { id: 'join', titleKey: 'help.faq.join.title', bodyKey: 'help.faq.join.body', section: 'plans' },
    { id: 'invite', titleKey: 'help.faq.invite.title', bodyKey: 'help.faq.invite.body', section: 'plans' },
    { id: 'chat', titleKey: 'help.faq.chat.title', bodyKey: 'help.faq.chat.body', section: 'social' },
    { id: 'friends', titleKey: 'help.faq.friends.title', bodyKey: 'help.faq.friends.body', section: 'social' },
    { id: 'profile', titleKey: 'help.faq.profile.title', bodyKey: 'help.faq.profile.body', section: 'account' },
    { id: 'ratings', titleKey: 'help.faq.ratings.title', bodyKey: 'help.faq.ratings.body', section: 'account' },
    { id: 'block', titleKey: 'help.faq.block.title', bodyKey: 'help.faq.block.body', section: 'safety' },
    { id: 'report', titleKey: 'help.faq.report.title', bodyKey: 'help.faq.report.body', section: 'safety' },
];

const ACTIONS: ActionItem[] = [
    { id: 'problem', titleKey: 'help.action.problem.title', descKey: 'help.action.problem.desc', supportTipo: 'problema' },
    { id: 'reportUser', titleKey: 'help.action.reportUser.title', descKey: 'help.action.reportUser.desc', supportTipo: 'denuncia_general' },
    { id: 'idea', titleKey: 'help.action.idea.title', descKey: 'help.action.idea.desc', supportTipo: 'idea' },
];

const SECTIONS: { key: FaqItem['section']; labelKey: string }[] = [
    { key: 'basics', labelKey: 'help.section.basics' },
    { key: 'plans', labelKey: 'help.section.plans' },
    { key: 'social', labelKey: 'help.section.social' },
    { key: 'account', labelKey: 'help.section.account' },
    { key: 'safety', labelKey: 'help.section.safety' },
];

export default function HelpCenterScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const filteredFaq = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return FAQ;
        return FAQ.filter(
            (item) =>
                t(item.titleKey).toLowerCase().includes(q) ||
                t(item.bodyKey).toLowerCase().includes(q),
        );
    }, [query, t]);

    const filteredActions = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return ACTIONS;
        return ACTIONS.filter(
            (item) =>
                t(item.titleKey).toLowerCase().includes(q) ||
                t(item.descKey).toLowerCase().includes(q),
        );
    }, [query, t]);

    const toggle = (id: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((prev) => (prev === id ? null : id));
    };

    const openSupport = (tipo: SupportTipo) => {
        router.push({ pathname: '/support-message', params: { tipo } });
    };

    const hasResults = filteredFaq.length > 0 || filteredActions.length > 0;

    return (
        <View style={styles.container}>
            <ScreenHeader title={t('settings.helpCenter')} onBack={() => router.back()} />

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={18} color={MUTED} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t('help.searchPlaceholder')}
                        placeholderTextColor="#94A3B8"
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                    />
                    {query.length > 0 ? (
                        <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                            <Ionicons name="close" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                    ) : null}
                </View>

                {SECTIONS.map((section) => {
                    const items = filteredFaq.filter((i) => i.section === section.key);
                    if (items.length === 0) return null;

                    return (
                        <View key={section.key} style={styles.section}>
                            <Text style={styles.sectionLabel}>{t(section.labelKey)}</Text>
                            <View style={styles.card}>
                                {items.map((item, idx) => {
                                    const open = expanded === item.id;
                                    const last = idx === items.length - 1;
                                    return (
                                        <View key={item.id} style={!last ? styles.rowBorder : undefined}>
                                            <TouchableOpacity
                                                style={styles.faqHeader}
                                                onPress={() => toggle(item.id)}
                                                activeOpacity={0.7}
                                            >
                                                <Text style={styles.faqTitle}>{t(item.titleKey)}</Text>
                                                <Ionicons
                                                    name={open ? 'chevron-up' : 'chevron-down'}
                                                    size={18}
                                                    color="#94A3B8"
                                                />
                                            </TouchableOpacity>
                                            {open ? (
                                                <Text style={styles.faqBody}>{t(item.bodyKey)}</Text>
                                            ) : null}
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}

                {filteredActions.length > 0 ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>{t('help.section.contact')}</Text>
                        <View style={styles.card}>
                            {filteredActions.map((item, idx) => {
                                const last = idx === filteredActions.length - 1;
                                return (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={[styles.actionRow, !last && styles.rowBorder]}
                                        onPress={() => openSupport(item.supportTipo)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.actionBody}>
                                            <Text style={styles.faqTitle}>{t(item.titleKey)}</Text>
                                            <Text style={styles.actionDesc}>{t(item.descKey)}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                ) : null}

                {!hasResults ? (
                    <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>{t('help.noResults')}</Text>
                        <Text style={styles.emptySub}>{t('help.noResultsHint')}</Text>
                    </View>
                ) : null}

                <View style={styles.footerCard}>
                    <Text style={styles.footerTitle}>{t('help.contactTitle')}</Text>
                    <Text style={styles.footerDesc}>{t('help.contactDesc')}</Text>
                    <TouchableOpacity
                        style={styles.footerBtn}
                        onPress={() => openSupport('contacto')}
                        activeOpacity={0.85}
                    >
                        <Text style={styles.footerBtnText}>{t('help.contactBtn')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.footerEmail}>{t('help.contactEmailHint')}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    scroll: { paddingHorizontal: 20, paddingTop: 8 },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CARD,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 12 : 8,
        gap: 10,
        marginBottom: 28,
        borderWidth: 1,
        borderColor: BORDER,
    },
    searchInput: { flex: 1, fontSize: 15, fontWeight: '500', color: INK },
    section: { marginBottom: 24 },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: MUTED,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginBottom: 10,
        paddingHorizontal: 2,
    },
    card: {
        backgroundColor: CARD,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        overflow: 'hidden',
    },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
    faqHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    faqTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: INK,
        lineHeight: 21,
    },
    faqBody: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        marginTop: -4,
        fontSize: 14,
        lineHeight: 22,
        color: MUTED,
        fontWeight: '500',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    actionBody: { flex: 1, gap: 4 },
    actionDesc: { fontSize: 13, lineHeight: 18, color: MUTED, fontWeight: '500' },
    empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: INK, textAlign: 'center' },
    emptySub: { marginTop: 8, fontSize: 14, lineHeight: 20, color: MUTED, textAlign: 'center' },
    footerCard: {
        marginTop: 4,
        backgroundColor: CARD,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 20,
    },
    footerTitle: { fontSize: 16, fontWeight: '700', color: INK },
    footerDesc: { marginTop: 8, fontSize: 14, lineHeight: 21, color: MUTED, fontWeight: '500' },
    footerBtn: {
        marginTop: 16,
        alignSelf: 'flex-start',
        backgroundColor: ACCENT,
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 10,
    },
    footerBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
    footerEmail: {
        marginTop: 14,
        fontSize: 13,
        lineHeight: 19,
        color: MUTED,
        fontWeight: '500',
    },
});
