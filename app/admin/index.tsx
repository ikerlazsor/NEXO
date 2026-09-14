import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useT } from '../../lib/i18n';
import {
    deleteInboxItem,
    fetchModerationCounts,
    fetchMessageReports,
    fetchPlanReports,
    fetchSupportTickets,
    fetchUserReports,
    planReportTitle,
    type InboxItemKind,
    type ModerationCounts,
    type MessageReportRow,
    type PlanReportRow,
    type SupportTicket,
    type UserReportRow,
} from '../../lib/moderation';
import { fetchOrganizerRequests, organizerTypeKey, type OrganizerRequest } from '../../lib/organizer';
import { fetchAccountAccess } from '../../lib/roles';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const DANGER = '#DC2626';

type TabKey = 'soporte' | 'planes' | 'usuarios' | 'mensajes' | 'organizadores';

function estadoColor(estado: string) {
    if (estado === 'abierto') return DANGER;
    if (estado === 'en_revision') return '#F59E0B';
    if (estado === 'resuelto') return '#10B981';
    return MUTED;
}

export default function AdminInboxScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [tab, setTab] = useState<TabKey>('soporte');
    const [counts, setCounts] = useState<ModerationCounts | null>(null);
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [planReports, setPlanReports] = useState<PlanReportRow[]>([]);
    const [userReports, setUserReports] = useState<UserReportRow[]>([]);
    const [messageReports, setMessageReports] = useState<MessageReportRow[]>([]);
    const [organizerRequests, setOrganizerRequests] = useState<OrganizerRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const load = useCallback(async () => {
        const access = await fetchAccountAccess();
        if (!access.isStaff) {
            setAllowed(false);
            setLoading(false);
            return;
        }
        setAllowed(true);
        const filter = showAll ? undefined : 'pendientes';
        const [c, s, p, u, m, o] = await Promise.all([
            fetchModerationCounts(),
            fetchSupportTickets(filter),
            fetchPlanReports(filter),
            fetchUserReports(filter),
            fetchMessageReports(filter),
            fetchOrganizerRequests(!showAll),
        ]);
        setCounts(c);
        setTickets(s);
        setPlanReports(p);
        setUserReports(u);
        setMessageReports(m);
        setOrganizerRequests(o);
        setLoading(false);
    }, [showAll]);

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            void load();
        }, [load]),
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
    };

    const confirmDeleteItem = (kind: InboxItemKind, id: string) => {
        Alert.alert(t('admin.deleteItemTitle'), t('admin.deleteItemMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                    const { error } = await deleteInboxItem(kind, id);
                    if (error) {
                        Alert.alert(t('admin.error'), error);
                        return;
                    }
                    await load();
                },
            },
        ]);
    };

    if (allowed === false) {
        return (
            <View style={styles.container}>
                <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
                <ScreenHeader title={t('admin.title')} onBack={() => router.back()} />
                <View style={styles.denied}>
                    <Ionicons name="lock-closed" size={40} color={MUTED} />
                    <Text style={styles.deniedText}>{t('admin.denied')}</Text>
                </View>
            </View>
        );
    }

    const tabs: { key: TabKey; label: string; count: number }[] = [
        { key: 'soporte', label: t('admin.tabSupport'), count: counts?.soporte ?? 0 },
        { key: 'planes', label: t('admin.tabPlans'), count: counts?.reportes_planes ?? 0 },
        { key: 'usuarios', label: t('admin.tabUsers'), count: counts?.reportes_usuarios ?? 0 },
        { key: 'mensajes', label: t('admin.tabMessages'), count: counts?.reportes_mensajes ?? 0 },
        { key: 'organizadores', label: t('admin.tabOrganizers'), count: counts?.organizadores ?? 0 },
    ];

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader
                title={t('admin.title')}
                onBack={() => router.back()}
                subtitle={
                    counts
                        ? `${t('admin.subtitle')} · ${t('admin.openCount', { n: counts.total })}`
                        : t('admin.subtitle')
                }
            />

            <View style={styles.toolbar}>
                <Pressable
                    style={[styles.filterChip, !showAll && styles.filterChipOn]}
                    onPress={() => setShowAll(false)}
                >
                    <Text style={[styles.filterText, !showAll && styles.filterTextOn]}>
                        {t('admin.filterOpen')}
                    </Text>
                </Pressable>
                <Pressable
                    style={[styles.filterChip, showAll && styles.filterChipOn]}
                    onPress={() => setShowAll(true)}
                >
                    <Text style={[styles.filterText, showAll && styles.filterTextOn]}>
                        {t('admin.filterAll')}
                    </Text>
                </Pressable>
            </View>

            <View style={styles.tabs}>
                {tabs.map((item) => {
                    const on = tab === item.key;
                    return (
                        <Pressable
                            key={item.key}
                            style={[styles.tab, on && styles.tabOn]}
                            onPress={() => setTab(item.key)}
                        >
                            <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                                {item.label}
                            </Text>
                            {item.count > 0 ? (
                                <View style={[styles.badge, on && styles.badgeOn]}>
                                    <Text style={[styles.badgeText, on && styles.badgeTextOn]}>
                                        {item.count}
                                    </Text>
                                </View>
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={PRIMARY_DARK} />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 28 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                    showsVerticalScrollIndicator={false}
                >
                    {tab === 'soporte' &&
                        (tickets.length === 0 ? (
                            <Empty label={t('admin.empty')} />
                        ) : (
                            tickets.map((item) => (
                                <View key={item.id} style={styles.card}>
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/admin/ticket/[id]',
                                                params: { id: item.id },
                                            })
                                        }
                                    >
                                        <View style={styles.cardTop}>
                                            <Text style={styles.cardType}>{t(`admin.tipo.${item.tipo}`)}</Text>
                                            <EstadoPill estado={item.estado} label={t(`admin.estado.${item.estado}`)} />
                                        </View>
                                        <Text style={styles.cardTitle} numberOfLines={1}>
                                            {item.asunto || t(`admin.tipo.${item.tipo}`)}
                                        </Text>
                                        <Text style={styles.cardBody} numberOfLines={2}>
                                            {item.mensaje}
                                        </Text>
                                        <Text style={styles.cardMeta}>
                                            {item.perfil?.nombre || '—'} ·{' '}
                                            {new Date(item.creado_en).toLocaleString()}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={styles.deleteBtn}
                                        onPress={() => confirmDeleteItem('soporte', item.id)}
                                        hitSlop={8}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={DANGER} />
                                        <Text style={styles.deleteBtnText}>{t('admin.removeFromInbox')}</Text>
                                    </Pressable>
                                </View>
                            ))
                        ))}

                    {tab === 'planes' &&
                        (planReports.length === 0 ? (
                            <Empty label={t('admin.empty')} />
                        ) : (
                            planReports.map((item) => (
                                <View key={item.id} style={styles.card}>
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/admin/report-plan/[id]',
                                                params: { id: item.id },
                                            })
                                        }
                                    >
                                        <View style={styles.cardTop}>
                                            <Text style={styles.cardType}>{t('admin.reportPlan')}</Text>
                                            <EstadoPill estado={item.estado} label={t(`admin.estado.${item.estado}`)} />
                                        </View>
                                        <Text style={styles.cardTitle} numberOfLines={1}>
                                            {planReportTitle(item)}
                                        </Text>
                                        {item.plan_eliminado ? (
                                            <Text style={styles.deletedTag}>{t('admin.planAlreadyDeleted')}</Text>
                                        ) : null}
                                        <Text style={styles.cardBody} numberOfLines={2}>
                                            {item.motivo}
                                            {item.mensaje ? ` — ${item.mensaje}` : ''}
                                        </Text>
                                        <Text style={styles.cardMeta}>
                                            {item.reportador?.nombre || '—'} ·{' '}
                                            {new Date(item.creado_en).toLocaleString()}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={styles.deleteBtn}
                                        onPress={() => confirmDeleteItem('plan', item.id)}
                                        hitSlop={8}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={DANGER} />
                                        <Text style={styles.deleteBtnText}>{t('admin.removeFromInbox')}</Text>
                                    </Pressable>
                                </View>
                            ))
                        ))}

                    {tab === 'usuarios' &&
                        (userReports.length === 0 ? (
                            <Empty label={t('admin.empty')} />
                        ) : (
                            userReports.map((item) => (
                                <View key={item.id} style={styles.card}>
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/admin/report-user/[id]',
                                                params: { id: item.id },
                                            })
                                        }
                                    >
                                        <View style={styles.cardTop}>
                                            <Text style={styles.cardType}>{t('admin.reportUser')}</Text>
                                            <EstadoPill estado={item.estado} label={t(`admin.estado.${item.estado}`)} />
                                        </View>
                                        <Text style={styles.cardTitle} numberOfLines={1}>
                                            {item.denunciado?.nombre || item.denunciado_id.slice(0, 8)}
                                        </Text>
                                        <Text style={styles.cardBody} numberOfLines={2}>
                                            {item.motivo}
                                            {item.mensaje ? ` — ${item.mensaje}` : ''}
                                        </Text>
                                        <Text style={styles.cardMeta}>
                                            {item.reportador?.nombre || '—'} ·{' '}
                                            {new Date(item.creado_en).toLocaleString()}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={styles.deleteBtn}
                                        onPress={() => confirmDeleteItem('user', item.id)}
                                        hitSlop={8}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={DANGER} />
                                        <Text style={styles.deleteBtnText}>{t('admin.removeFromInbox')}</Text>
                                    </Pressable>
                                </View>
                            ))
                        ))}

                    {tab === 'mensajes' &&
                        (messageReports.length === 0 ? (
                            <Empty label={t('admin.empty')} />
                        ) : (
                            messageReports.map((item) => (
                                <View key={item.id} style={styles.card}>
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/admin/report-message/[id]',
                                                params: { id: item.id },
                                            })
                                        }
                                    >
                                        <View style={styles.cardTop}>
                                            <Text style={styles.cardType}>{t('admin.reportMessage')}</Text>
                                            <EstadoPill estado={item.estado} label={t(`admin.estado.${item.estado}`)} />
                                        </View>
                                        <Text style={styles.cardTitle} numberOfLines={1}>
                                            {item.denunciado_nombre_snapshot || item.denunciado_usuario_snapshot || '—'}
                                        </Text>
                                        <Text style={styles.cardBody} numberOfLines={2}>
                                            {item.contenido_snapshot || `[${item.tipo_snapshot}]`}
                                        </Text>
                                        <Text style={styles.cardMeta}>
                                            {item.reportador?.nombre || '—'} ·{' '}
                                            {new Date(item.creado_en).toLocaleString()}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={styles.deleteBtn}
                                        onPress={() => confirmDeleteItem('message', item.id)}
                                        hitSlop={8}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={DANGER} />
                                        <Text style={styles.deleteBtnText}>{t('admin.removeFromInbox')}</Text>
                                    </Pressable>
                                </View>
                            ))
                        ))}

                    {tab === 'organizadores' &&
                        (organizerRequests.length === 0 ? (
                            <Empty label={t('admin.empty')} />
                        ) : (
                            organizerRequests.map((item) => (
                                <View key={item.id} style={styles.card}>
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/admin/organizer/[id]',
                                                params: { id: item.id },
                                            })
                                        }
                                    >
                                        <View style={styles.cardTop}>
                                            <Text style={styles.cardType}>{t(organizerTypeKey(item.tipo))}</Text>
                                            <EstadoPill
                                                estado={item.estado === 'pendiente' ? 'abierto' : item.estado === 'aprobado' ? 'resuelto' : 'descartado'}
                                                label={item.estado}
                                            />
                                        </View>
                                        <Text style={styles.cardTitle} numberOfLines={1}>
                                            {item.nombre_org}
                                        </Text>
                                        <Text style={styles.cardBody} numberOfLines={2}>
                                            {item.descripcion}
                                        </Text>
                                        <Text style={styles.cardMeta}>
                                            {item.perfil?.nombre || '—'} ·{' '}
                                            {new Date(item.creado_en).toLocaleString()}
                                        </Text>
                                    </Pressable>
                                </View>
                            ))
                        ))}
                </ScrollView>
            )}
        </View>
    );
}

function EstadoPill({ estado, label }: { estado: string; label: string }) {
    return (
        <View style={[styles.pill, { backgroundColor: `${estadoColor(estado)}18` }]}>
            <Text style={[styles.pillText, { color: estadoColor(estado) }]}>{label}</Text>
        </View>
    );
}

function Empty({ label }: { label: string }) {
    return (
        <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={42} color="#CBD5E1" />
            <Text style={styles.emptyText}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
    deniedText: { fontSize: 16, fontWeight: '700', color: MUTED, textAlign: 'center' },
    toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 10 },
    filterChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    filterChipOn: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    filterText: { fontSize: 13, fontWeight: '700', color: MUTED },
    filterTextOn: { color: '#FFF' },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
    tab: {
        minWidth: '30%',
        flexGrow: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    tabOn: { backgroundColor: '#EFF6FF', borderColor: PRIMARY },
    tabText: { fontSize: 12, fontWeight: '800', color: MUTED },
    tabTextOn: { color: PRIMARY_DARK },
    badge: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 6,
        backgroundColor: '#FEE2E2',
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeOn: { backgroundColor: DANGER },
    badgeText: { fontSize: 11, fontWeight: '800', color: DANGER },
    badgeTextOn: { color: '#FFF' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: 20, gap: 12 },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E8EEF5',
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    cardType: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    cardTitle: { fontSize: 16, fontWeight: '900', color: INK },
    cardBody: { fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 20 },
    cardMeta: { fontSize: 12, color: '#94A3B8', marginTop: 10, fontWeight: '600' },
    deletedTag: {
        marginTop: 6,
        alignSelf: 'flex-start',
        fontSize: 11,
        fontWeight: '800',
        color: DANGER,
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        overflow: 'hidden',
    },
    deleteBtn: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    deleteBtnText: { fontSize: 13, fontWeight: '700', color: DANGER },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    pillText: { fontSize: 11, fontWeight: '800' },
    empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
    emptyText: { fontSize: 15, fontWeight: '700', color: MUTED },
});
