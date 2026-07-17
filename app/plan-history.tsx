import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { PlanImage } from '../components/PlanImage';
import { isFeedPlan } from '../lib/feedPlans';
import { useT } from '../lib/i18n';
import { getPlanCategoryDisplay } from '../lib/categories';
import { resolvePlanImageSource } from '../lib/sports';
import { supabase } from '../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

type HistoryItem = {
    id: string;
    planId: string;
    titulo: string;
    imagen_url: string | null;
    categoria: string | null;
    tipo_deporte: string | null;
    fecha_evento: string | null;
    completedAt: string | null;
};

export default function PlanHistoryScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<HistoryItem[]>([]);
    const hasDataRef = useRef(false);

    const fetchHistory = useCallback(async () => {
        try {
            if (!hasDataRef.current) setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.replace('/login');
                return;
            }

            const { data, error } = await supabase
                .from('historial_planes')
                .select(`
                    id,
                    plan_id,
                    planes:plan_id (
                        id,
                        titulo,
                        imagen_url,
                        categoria,
                        tipo_deporte,
                        fecha_evento
                    )
                `)
                .eq('usuario_id', user.id);

            if (error) throw error;

            const mapped: HistoryItem[] = (data ?? [])
                .map((row) => {
                    const raw = row.planes;
                    const plan = Array.isArray(raw) ? raw[0] : raw;
                    if (!plan || !isFeedPlan(plan)) return null;
                    return {
                        id: row.id as string,
                        planId: (plan.id as string) ?? (row.plan_id as string),
                        titulo: (plan.titulo as string) || t('profile.user'),
                        imagen_url: (plan.imagen_url as string | null) ?? null,
                        categoria: (plan.categoria as string | null) ?? null,
                        tipo_deporte: (plan.tipo_deporte as string | null) ?? null,
                        fecha_evento: (plan.fecha_evento as string | null) ?? null,
                        completedAt: (plan.fecha_evento as string | null) ?? null,
                    };
                })
                .filter(Boolean) as HistoryItem[];

            mapped.sort((a, b) => {
                const ta = a.fecha_evento ? new Date(a.fecha_evento).getTime() : 0;
                const tb = b.fecha_evento ? new Date(b.fecha_evento).getTime() : 0;
                return tb - ta;
            });

            setItems(mapped);
            hasDataRef.current = mapped.length > 0;
        } catch (e) {
            console.error(e);
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [router, t]);

    useFocusEffect(useCallback(() => { void fetchHistory(); }, [fetchHistory]));

    const formatDate = (iso: string | null) => {
        if (!iso) return t('card.noDate');
        return new Date(iso).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('history.title')}</Text>
                <View style={{ width: 45 }} />
            </View>

            <Text style={styles.subtitle}>{t('history.privateHint')}</Text>

            {loading && items.length === 0 ? (
                <ActivityIndicator color={PRIMARY_DARK} style={{ marginTop: 40 }} />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        !loading ? (
                            <View style={styles.empty}>
                                <Ionicons name="time-outline" size={48} color={PRIMARY_DARK} />
                                <Text style={styles.emptyTitle}>{t('history.empty')}</Text>
                                <Text style={styles.emptySub}>{t('history.emptySub')}</Text>
                            </View>
                        ) : null
                    }
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.card}
                            activeOpacity={0.85}
                            onPress={() => router.push({ pathname: '/plan/[id]', params: { id: item.planId } })}
                        >
                            <PlanImage
                                source={resolvePlanImageSource(item.imagen_url)}
                                style={styles.thumb}
                                recyclingKey={item.planId}
                            />
                            <View style={styles.cardBody}>
                                <Text style={styles.cardTitle} numberOfLines={1}>{item.titulo}</Text>
                                <Text style={styles.cardCat}>{getPlanCategoryDisplay(item, t)}</Text>
                                <Text style={styles.cardDate}>{formatDate(item.fecha_evento ?? item.completedAt)}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                        </TouchableOpacity>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 60 : 44,
        paddingBottom: 8,
    },
    backBtn: {
        width: 45,
        height: 45,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 15,
    },
    title: { fontSize: 20, fontWeight: '900', color: INK },
    subtitle: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        paddingHorizontal: 28,
        marginBottom: 12,
        lineHeight: 18,
    },
    list: { paddingHorizontal: 20, paddingBottom: 40 },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 12,
        marginBottom: 10,
        gap: 12,
        elevation: 3,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
    },
    thumb: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#E3ECFB' },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '800', color: INK },
    cardCat: { fontSize: 12, color: PRIMARY_DARK, fontWeight: '600', marginTop: 2 },
    cardDate: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
    empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 10 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK },
    emptySub: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
});
