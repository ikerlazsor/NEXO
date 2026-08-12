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
    fetchSupportTickets,
    setTicketEstado,
    type SupportTicket,
    type TicketEstado,
} from '../../../lib/moderation';
import { fetchAccountAccess } from '../../../lib/roles';
import { supabase } from '../../../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const ESTADOS: TicketEstado[] = ['abierto', 'en_revision', 'resuelto', 'descartado'];

export default function AdminTicketDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [ticket, setTicket] = useState<SupportTicket | null>(null);
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
            .from('mensajes_soporte')
            .select(
                'id, usuario_id, tipo, asunto, mensaje, estado, notas_internas, creado_en, actualizado_en, revisado_en, perfil:perfiles!usuario_id(nombre, nombre_usuario, avatar_url)',
            )
            .eq('id', id)
            .maybeSingle();
        if (error || !data) {
            // fallback list search
            const all = await fetchSupportTickets();
            const found = all.find((x) => x.id === id) ?? null;
            setTicket(found);
            setNotes(found?.notas_internas ?? '');
        } else {
            const row = {
                ...data,
                perfil: Array.isArray(data.perfil) ? data.perfil[0] : data.perfil,
            } as SupportTicket;
            setTicket(row);
            setNotes(row.notas_internas ?? '');
        }
        setLoading(false);
    }, [id]);

    useEffect(() => {
        void load();
    }, [load]);

    const setEstado = (estado: TicketEstado) => {
        if (!ticket) return;
        Alert.alert(t('admin.setStatus'), t(`admin.estado.${estado}`), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.ok'),
                onPress: async () => {
                    setSaving(true);
                    const { error } = await setTicketEstado(ticket.id, estado, notes);
                    setSaving(false);
                    if (error) {
                        const mapped = t(`admin.err.${error}`);
                        Alert.alert(t('admin.error'), mapped.startsWith('admin.err.') ? error : mapped);
                        return;
                    }
                    await load();
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

    if (!ticket) {
        return (
            <View style={styles.container}>
                <ScreenHeader title={t('admin.ticket')} onBack={() => router.back()} />
                <Text style={styles.missing}>{t('admin.notFound')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('admin.ticket')} onBack={() => router.back()} />
            <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
                <Text style={styles.type}>{t(`admin.tipo.${ticket.tipo}`)}</Text>
                <Text style={styles.title}>{ticket.asunto || t(`admin.tipo.${ticket.tipo}`)}</Text>
                <Text style={styles.meta}>
                    @{ticket.perfil?.nombre_usuario || '—'} · {new Date(ticket.creado_en).toLocaleString()}
                </Text>
                <View style={styles.box}>
                    <Text style={styles.boxText}>{ticket.mensaje}</Text>
                </View>

                <TouchableOpacity
                    style={styles.linkBtn}
                    onPress={() =>
                        router.push({ pathname: '/user-profile/[id]', params: { id: ticket.usuario_id } })
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
                            style={[styles.statusBtn, ticket.estado === e && styles.statusBtnOn]}
                            disabled={saving}
                            onPress={() => setEstado(e)}
                        >
                            <Text style={[styles.statusText, ticket.estado === e && styles.statusTextOn]}>
                                {t(`admin.estado.${e}`)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {isOwner ? (
                    <Text style={styles.hint}>{t('admin.ownerActionsHint')}</Text>
                ) : null}

                <TouchableOpacity
                    style={styles.removeBtn}
                    disabled={saving}
                    onPress={() => {
                        Alert.alert(t('admin.deleteItemTitle'), t('admin.deleteItemMsg'), [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                                text: t('common.delete'),
                                style: 'destructive',
                                onPress: async () => {
                                    setSaving(true);
                                    const { error } = await deleteInboxItem('soporte', ticket.id);
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
                    <Ionicons name="trash-outline" size={18} color="#FFF" />
                    <Text style={styles.removeBtnText}>{t('admin.removeFromInbox')}</Text>
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
    type: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    title: { fontSize: 22, fontWeight: '900', color: INK, marginTop: 6 },
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
    hint: { marginTop: 20, fontSize: 13, color: MUTED, lineHeight: 18 },
    removeBtn: {
        marginTop: 24,
        backgroundColor: '#64748B',
        borderRadius: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    removeBtnText: { color: '#FFF', fontWeight: '800' },
});
