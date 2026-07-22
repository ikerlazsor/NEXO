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
    banUser,
    deleteInboxItem,
    deleteUserAdmin,
    setReportEstado,
    type TicketEstado,
    type UserReportRow,
} from '../../../lib/moderation';
import { fetchAccountAccess } from '../../../lib/roles';
import { supabase } from '../../../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const DANGER = '#DC2626';

const ESTADOS: TicketEstado[] = ['abierto', 'en_revision', 'resuelto', 'descartado'];

export default function AdminReportUserScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [row, setRow] = useState<UserReportRow | null>(null);
    const [notes, setNotes] = useState('');
    const [banReason, setBanReason] = useState('');
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
            .from('reportes_usuarios')
            .select(
                'id, denunciado_id, reportador_id, motivo, mensaje, estado, notas_internas, creado_en, revisado_en, denunciado:perfiles!denunciado_id(nombre, nombre_usuario, baneado), reportador:perfiles!reportador_id(nombre, nombre_usuario)',
            )
            .eq('id', id)
            .maybeSingle();
        if (!error && data) {
            const mapped = {
                ...data,
                denunciado: Array.isArray(data.denunciado) ? data.denunciado[0] : data.denunciado,
                reportador: Array.isArray(data.reportador) ? data.reportador[0] : data.reportador,
            } as UserReportRow;
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
                    const { error } = await setReportEstado('user', row.id, estado, notes);
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

    const confirmBan = (banned: boolean) => {
        if (!row || !isOwner) return;
        Alert.alert(
            banned ? t('admin.banTitle') : t('admin.unbanTitle'),
            banned ? t('admin.banMsg') : t('admin.unbanMsg'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: banned ? t('admin.banConfirm') : t('admin.unbanConfirm'),
                    style: 'destructive',
                    onPress: async () => {
                        setSaving(true);
                        const { error } = await banUser(row.denunciado_id, banReason || undefined, banned);
                        setSaving(false);
                        if (error) {
                            const mapped = t(`admin.err.${error}`);
                            Alert.alert(t('admin.error'), mapped.startsWith('admin.err.') ? error : mapped);
                            return;
                        }
                        await load();
                        Alert.alert(t('admin.done'), banned ? t('admin.bannedOk') : t('admin.unbannedOk'));
                    },
                },
            ],
        );
    };

    const confirmDeleteUser = () => {
        if (!row || !isOwner) return;
        Alert.alert(t('admin.deleteUserTitle'), t('admin.deleteUserMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('admin.deleteUserConfirm'),
                style: 'destructive',
                onPress: async () => {
                    setSaving(true);
                    const { error } = await deleteUserAdmin(row.denunciado_id);
                    setSaving(false);
                    if (error) {
                        const mapped = t(`admin.err.${error}`);
                        Alert.alert(t('admin.error'), mapped.startsWith('admin.err.') ? error : mapped);
                        return;
                    }
                    Alert.alert(t('admin.done'), t('admin.userDeleted'), [
                        { text: t('common.ok'), onPress: () => router.back() },
                    ]);
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
                <ScreenHeader title={t('admin.reportUser')} onBack={() => router.back()} />
                <Text style={styles.missing}>{t('admin.notFound')}</Text>
            </View>
        );
    }

    const isBanned = row.denunciado?.baneado === true;

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('admin.reportUser')} onBack={() => router.back()} />
            <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
                <Text style={styles.title}>
                    @{row.denunciado?.nombre_usuario || row.denunciado_id.slice(0, 8)}
                </Text>
                {isBanned ? (
                    <View style={styles.bannedTag}>
                        <Text style={styles.bannedTagText}>{t('admin.userIsBanned')}</Text>
                    </View>
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

                <TouchableOpacity
                    style={styles.linkBtn}
                    onPress={() =>
                        router.push({ pathname: '/user-profile/[id]', params: { id: row.denunciado_id } })
                    }
                >
                    <Ionicons name="person-outline" size={18} color={PRIMARY_DARK} />
                    <Text style={styles.linkText}>{t('admin.viewProfile')}</Text>
                </TouchableOpacity>

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

                {isOwner ? (
                    <>
                        <Text style={styles.label}>{t('admin.banReason')}</Text>
                        <TextInput
                            style={[styles.input, { minHeight: 56 }]}
                            value={banReason}
                            onChangeText={setBanReason}
                            placeholder={t('admin.banReasonPlaceholder')}
                            placeholderTextColor="#94A3B8"
                        />
                        <TouchableOpacity
                            style={[styles.dangerBtn, { backgroundColor: '#B45309' }]}
                            onPress={() => confirmBan(!isBanned)}
                            disabled={saving}
                        >
                            <Ionicons name="ban-outline" size={18} color="#FFF" />
                            <Text style={styles.dangerText}>
                                {isBanned ? t('admin.unbanConfirm') : t('admin.banConfirm')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.dangerBtn} onPress={confirmDeleteUser} disabled={saving}>
                            <Ionicons name="trash-outline" size={18} color="#FFF" />
                            <Text style={styles.dangerText}>{t('admin.deleteUserConfirm')}</Text>
                        </TouchableOpacity>
                    </>
                ) : null}

                <TouchableOpacity
                    style={[styles.dangerBtn, { backgroundColor: '#64748B', marginTop: 12 }]}
                    disabled={saving}
                    onPress={() => {
                        Alert.alert(t('admin.deleteItemTitle'), t('admin.deleteItemMsg'), [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                                text: t('common.delete'),
                                style: 'destructive',
                                onPress: async () => {
                                    setSaving(true);
                                    const { error } = await deleteInboxItem('user', row.id);
                                    setSaving(false);
                                    if (error) {
                                        Alert.alert(t('admin.error'), error);
                                        return;
                                    }
                                    router.back();
                                },
                            },
                        ]);
                    }}
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
    bannedTag: {
        marginTop: 8,
        alignSelf: 'flex-start',
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    bannedTagText: { fontSize: 12, fontWeight: '800', color: DANGER },
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
        marginTop: 14,
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
