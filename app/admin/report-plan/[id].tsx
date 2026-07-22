import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../../lib/nexoAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useT } from '../../../lib/i18n';
import {
    deleteInboxItem,
    deletePlanAdmin,
    planReportTitle,
    setReportEstado,
    type PlanReportRow,
    type TicketEstado,
} from '../../../lib/moderation';
import { fetchAccountAccess } from '../../../lib/roles';
import { supabase } from '../../../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const DANGER = '#DC2626';

const ESTADOS: TicketEstado[] = ['abierto', 'en_revision', 'resuelto', 'descartado'];

export default function AdminReportPlanScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [row, setRow] = useState<PlanReportRow | null>(null);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isOwner, setIsOwner] = useState(false);

    const load = useCallback(async () => {
        const access = await fetchAccountAccess();
        if (!access.isStaff) {
            setLoading(false);
            return;
        }
        setIsOwner(access.isOwner);
        const { data, error } = await supabase
            .from('reportes_planes')
            .select(
                'id, plan_id, reportador_id, motivo, mensaje, estado, notas_internas, creado_en, revisado_en, plan_titulo, plan_eliminado, plan_eliminado_en, plan:planes!plan_id(id, titulo, creador_id), reportador:perfiles!reportador_id(nombre, nombre_usuario)',
            )
            .eq('id', id)
            .maybeSingle();
        if (!error && data) {
            const mapped = {
                ...data,
                plan: Array.isArray(data.plan) ? data.plan[0] : data.plan,
                reportador: Array.isArray(data.reportador) ? data.reportador[0] : data.reportador,
            } as PlanReportRow;
            setRow(mapped);
            setNotes(mapped.notas_internas ?? '');
        }
        setLoading(false);
    }, [id]);

    useEffect(() => {
        void load();
    }, [load]);

    const setEstado = (estado: TicketEstado) => {
        if (!row) return;
        Alert.alert(t('admin.setStatus'), t(`admin.estado.${estado}`), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.ok'),
                onPress: async () => {
                    setSaving(true);
                    const { error } = await setReportEstado('plan', row.id, estado, notes);
                    setSaving(false);
                    if (error) {
                        Alert.alert(t('admin.error'), error);
                        return;
                    }
                    await load();
                },
            },
        ]);
    };

    const confirmDeletePlan = () => {
        if (!row || !isOwner || !row.plan_id || row.plan_eliminado) return;
        Alert.alert(t('admin.deletePlanTitle'), t('admin.deletePlanMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('admin.deletePlanConfirm'),
                style: 'destructive',
                onPress: async () => {
                    setSaving(true);
                    const { error } = await deletePlanAdmin(row.plan_id!);
                    setSaving(false);
                    if (error) {
                        Alert.alert(t('admin.error'), error);
                        return;
                    }
                    Alert.alert(t('admin.done'), t('admin.planDeletedKeepReport'));
                    await load();
                },
            },
        ]);
    };

    const confirmRemoveFromInbox = () => {
        if (!row) return;
        Alert.alert(t('admin.deleteItemTitle'), t('admin.deleteItemMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                    setSaving(true);
                    const { error } = await deleteInboxItem('plan', row.id);
                    setSaving(false);
                    if (error) {
                        Alert.alert(t('admin.error'), error);
                        return;
                    }
                    router.back();
                },
            },
        ]);
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={PRIMARY_DARK} />
            </View>
        );
    }

    if (!row) {
        return (
            <View style={styles.container}>
                <ScreenHeader title={t('admin.reportPlan')} onBack={() => router.back()} />
                <Text style={styles.missing}>{t('admin.notFound')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('admin.reportPlan')} onBack={() => router.back()} />
            <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
                <Text style={styles.title}>{planReportTitle(row)}</Text>
                {row.plan_eliminado ? (
                    <Text style={styles.deletedBanner}>{t('admin.planAlreadyDeleted')}</Text>
                ) : null}
                <Text style={styles.meta}>
                    {t('admin.reason')}: {row.motivo}
                </Text>
                <Text style={styles.meta}>
                    @{row.reportador?.nombre_usuario || '—'} · {new Date(row.creado_en).toLocaleString()}
                </Text>
                {row.mensaje ? (
                    <View style={styles.box}>
                        <Text style={styles.boxText}>{row.mensaje}</Text>
                    </View>
                ) : null}

                {row.plan_id && !row.plan_eliminado ? (
                    <TouchableOpacity
                        style={styles.linkBtn}
                        onPress={() => router.push({ pathname: '/plan/[id]', params: { id: row.plan_id! } })}
                    >
                        <Ionicons name="calendar-outline" size={18} color={PRIMARY_DARK} />
                        <Text style={styles.linkText}>{t('admin.viewPlan')}</Text>
                    </TouchableOpacity>
                ) : null}

                <Text style={styles.label}>{t('admin.internalNotes')}</Text>
                <TextInput
                    style={styles.input}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder={t('admin.notesPlaceholder')}
                    placeholderTextColor="#94A3B8"
                    multiline
                />

                <Text style={styles.label}>{t('admin.setStatus')}</Text>
                <View style={styles.statusRow}>
                    {ESTADOS.map((e) => (
                        <TouchableOpacity
                            key={e}
                            style={[styles.statusBtn, row.estado === e && styles.statusBtnOn]}
                            disabled={saving}
                            onPress={() => setEstado(e)}
                        >
                            <Text style={[styles.statusText, row.estado === e && styles.statusTextOn]}>
                                {t(`admin.estado.${e}`)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {isOwner && row.plan_id && !row.plan_eliminado ? (
                    <TouchableOpacity style={styles.dangerBtn} onPress={confirmDeletePlan} disabled={saving}>
                        <Ionicons name="trash-outline" size={18} color="#FFF" />
                        <Text style={styles.dangerText}>{t('admin.deletePlanConfirm')}</Text>
                    </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                    style={[styles.dangerBtn, { backgroundColor: '#64748B', marginTop: isOwner && row.plan_id && !row.plan_eliminado ? 12 : 28 }]}
                    onPress={confirmRemoveFromInbox}
                    disabled={saving}
                >
                    <Ionicons name="close-circle-outline" size={18} color="#FFF" />
                    <Text style={styles.dangerText}>{t('admin.removeFromInbox')}</Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    missing: { textAlign: 'center', marginTop: 40, color: MUTED, fontWeight: '700' },
    body: { paddingHorizontal: 20 },
    title: { fontSize: 22, fontWeight: '900', color: INK },
    deletedBanner: {
        marginTop: 8,
        alignSelf: 'flex-start',
        fontSize: 12,
        fontWeight: '800',
        color: DANGER,
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        overflow: 'hidden',
    },
    meta: { fontSize: 13, color: MUTED, marginTop: 8, fontWeight: '600' },
    box: {
        marginTop: 16,
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    boxText: { fontSize: 15, color: INK, lineHeight: 22 },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
    linkText: { color: PRIMARY_DARK, fontWeight: '800' },
    label: { marginTop: 22, marginBottom: 8, fontSize: 13, fontWeight: '800', color: MUTED },
    input: {
        backgroundColor: '#FFF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        padding: 14,
        minHeight: 90,
        textAlignVertical: 'top',
        color: INK,
        fontWeight: '600',
    },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusBtn: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    statusBtnOn: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    statusText: { fontSize: 12, fontWeight: '800', color: MUTED },
    statusTextOn: { color: '#FFF' },
    dangerBtn: {
        marginTop: 28,
        backgroundColor: DANGER,
        borderRadius: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    dangerText: { color: '#FFF', fontWeight: '800' },
});
