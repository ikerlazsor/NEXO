import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useT } from '../../lib/i18n';
import { fetchOrganizerRequests, organizerTypeKey, type OrganizerRequest } from '../../lib/organizer';
import { fetchAccountAccess } from '../../lib/roles';

const PRIMARY_DARK = '#2563EB';
const MUTED = '#64748B';
const INK = '#0F2A4A';

export default function AdminOrganizersScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [rows, setRows] = useState<OrganizerRequest[]>([]);

    const load = useCallback(async () => {
        const access = await fetchAccountAccess();
        if (!access.isStaff) {
            setAllowed(false);
            setLoading(false);
            return;
        }
        setAllowed(true);
        const data = await fetchOrganizerRequests(!showAll);
        setRows(data);
        setLoading(false);
    }, [showAll]);

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            void load();
        }, [load]),
    );

    if (allowed === false) {
        return (
            <View style={styles.container}>
                <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
                <ScreenHeader title={t('admin.organizersTitle')} onBack={() => router.back()} />
                <View style={styles.denied}>
                    <Ionicons name="lock-closed" size={40} color={MUTED} />
                    <Text style={styles.deniedText}>{t('admin.denied')}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader
                title={t('admin.organizersTitle')}
                onBack={() => router.back()}
                subtitle={t('admin.organizersSubtitle')}
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

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={PRIMARY_DARK} />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 28 }]}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={async () => {
                                setRefreshing(true);
                                await load();
                                setRefreshing(false);
                            }}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {rows.length === 0 ? (
                        <View style={styles.empty}>
                            <Ionicons name="checkmark-circle-outline" size={42} color="#CBD5E1" />
                            <Text style={styles.emptyText}>{t('admin.empty')}</Text>
                        </View>
                    ) : (
                        rows.map((item) => (
                            <Pressable
                                key={item.id}
                                style={styles.card}
                                onPress={() =>
                                    router.push({
                                        pathname: '/admin/organizer/[id]',
                                        params: { id: item.id },
                                    })
                                }
                            >
                                <View style={styles.cardTop}>
                                    <Text style={styles.cardType}>{t(organizerTypeKey(item.tipo))}</Text>
                                    <View
                                        style={[
                                            styles.pill,
                                            {
                                                backgroundColor:
                                                    item.estado === 'pendiente'
                                                        ? '#FEE2E2'
                                                        : item.estado === 'aprobado'
                                                          ? '#DCFCE7'
                                                          : '#F1F5F9',
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.pillText,
                                                {
                                                    color:
                                                        item.estado === 'pendiente'
                                                            ? '#DC2626'
                                                            : item.estado === 'aprobado'
                                                              ? '#15803D'
                                                              : MUTED,
                                                },
                                            ]}
                                        >
                                            {item.estado === 'pendiente'
                                                ? t('admin.filterOpen')
                                                : item.estado === 'aprobado'
                                                  ? t('organizer.approve')
                                                  : t('organizer.reject')}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={styles.cardTitle} numberOfLines={1}>
                                    {item.nombre_org}
                                </Text>
                                <Text style={styles.cardBody} numberOfLines={2}>
                                    {item.descripcion}
                                </Text>
                                <Text style={styles.cardMeta}>
                                    {item.perfil?.nombre || '—'}
                                    {item.ciudad ? ` · ${item.ciudad}` : ''} ·{' '}
                                    {new Date(item.creado_en).toLocaleString()}
                                </Text>
                            </Pressable>
                        ))
                    )}
                </ScrollView>
            )}
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: 20, gap: 12 },
    empty: { alignItems: 'center', paddingTop: 48, gap: 10 },
    emptyText: { color: MUTED, fontWeight: '700' },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    cardType: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    cardTitle: { fontSize: 17, fontWeight: '800', color: INK },
    cardBody: { marginTop: 4, fontSize: 14, color: MUTED, lineHeight: 20, fontWeight: '600' },
    cardMeta: { marginTop: 8, fontSize: 12, color: '#94A3B8', fontWeight: '600' },
    pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    pillText: { fontSize: 11, fontWeight: '800' },
});
