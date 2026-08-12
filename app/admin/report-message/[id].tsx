import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { Alert } from '../../../lib/nexoAlert';
import { useT } from '../../../lib/i18n';
import {
    deleteInboxItem,
    setReportEstado,
    type MessageReportRow,
    type TicketEstado,
} from '../../../lib/moderation';
import { fetchAccountAccess } from '../../../lib/roles';
import { supabase } from '../../../lib/supabase';
import { resolveChatFileUrl } from '../../../lib/chatUpload';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const DANGER = '#DC2626';
const ESTADOS: TicketEstado[] = ['abierto', 'en_revision', 'resuelto', 'descartado'];

export default function AdminReportMessageScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [row, setRow] = useState<MessageReportRow | null>(null);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);

    const load = useCallback(async () => {
        const access = await fetchAccountAccess();
        if (!access.isStaff) {
            setLoading(false);
            return;
        }
        const { data, error } = await supabase
            .from('reportes_mensajes')
            .select(
                'id, mensaje_id, reportador_id, denunciado_id, motivo, mensaje, contenido_snapshot, tipo_snapshot, archivo_url_snapshot, denunciado_nombre_snapshot, denunciado_usuario_snapshot, estado, notas_internas, creado_en, revisado_en, reportador:perfiles!reportador_id(nombre, nombre_usuario)',
            )
            .eq('id', id)
            .maybeSingle();
        if (!error && data) {
            const mapped = {
                ...data,
                reportador: Array.isArray(data.reportador) ? data.reportador[0] : data.reportador,
            } as MessageReportRow;
            setRow(mapped);
            setNotes(mapped.notas_internas ?? '');
            setAttachmentUrl(await resolveChatFileUrl(mapped.archivo_url_snapshot));
        }
        setLoading(false);
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    const setEstado = (estado: TicketEstado) => {
        if (!row) return;
        Alert.alert(t('admin.setStatus'), t(`admin.estado.${estado}`), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.ok'),
                onPress: async () => {
                    setSaving(true);
                    const { error } = await setReportEstado('message', row.id, estado, notes);
                    setSaving(false);
                    if (error) Alert.alert(t('admin.error'), error);
                    else await load();
                },
            },
        ]);
    };

    if (loading) return <View style={styles.center}><ActivityIndicator color={PRIMARY_DARK} /></View>;
    if (!row) {
        return (
            <View style={styles.container}>
                <ScreenHeader title={t('admin.reportMessage')} onBack={() => router.back()} />
                <Text style={styles.missing}>{t('admin.notFound')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('admin.reportMessage')} onBack={() => router.back()} />
            <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
                <Text style={styles.title}>
                    @{row.denunciado_usuario_snapshot || row.denunciado_nombre_snapshot || '—'}
                </Text>
                <Text style={styles.meta}>{t('admin.reason')}: {row.motivo}</Text>
                <Text style={styles.meta}>
                    @{row.reportador?.nombre_usuario || '—'} · {new Date(row.creado_en).toLocaleString()}
                </Text>

                <Text style={styles.label}>{t('admin.messageSnapshot')}</Text>
                <View style={styles.box}>
                    <Text style={styles.boxText}>
                        {row.contenido_snapshot || `[${row.tipo_snapshot}]`}
                    </Text>
                    {row.archivo_url_snapshot ? (
                        <TouchableOpacity
                            style={styles.attachmentBtn}
                            disabled={!attachmentUrl}
                            onPress={() => attachmentUrl && void Linking.openURL(attachmentUrl)}
                        >
                            <Ionicons name="attach-outline" size={17} color={attachmentUrl ? PRIMARY_DARK : MUTED} />
                            <Text style={[styles.attachment, attachmentUrl && styles.attachmentReady]}>
                                {attachmentUrl ? t('admin.openAttachment') : t('admin.attachmentUnavailable')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>

                {row.mensaje ? (
                    <>
                        <Text style={styles.label}>{t('report.messageOptional')}</Text>
                        <View style={styles.box}><Text style={styles.boxText}>{row.mensaje}</Text></View>
                    </>
                ) : null}

                {row.denunciado_id ? (
                    <TouchableOpacity
                        style={styles.linkBtn}
                        onPress={() => router.push({
                            pathname: '/user-profile/[id]',
                            params: { id: row.denunciado_id as string },
                        })}
                    >
                        <Ionicons name="person-outline" size={18} color={PRIMARY_DARK} />
                        <Text style={styles.linkText}>{t('admin.viewProfile')}</Text>
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
                    {ESTADOS.map((estado) => (
                        <TouchableOpacity
                            key={estado}
                            style={[styles.statusBtn, row.estado === estado && styles.statusBtnOn]}
                            disabled={saving}
                            onPress={() => setEstado(estado)}
                        >
                            <Text style={[styles.statusText, row.estado === estado && styles.statusTextOn]}>
                                {t(`admin.estado.${estado}`)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <TouchableOpacity
                    style={styles.dangerBtn}
                    disabled={saving}
                    onPress={() => Alert.alert(t('admin.deleteItemTitle'), t('admin.deleteItemMsg'), [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                            text: t('common.delete'),
                            style: 'destructive',
                            onPress: async () => {
                                setSaving(true);
                                const { error } = await deleteInboxItem('message', row.id);
                                setSaving(false);
                                if (error) Alert.alert(t('admin.error'), error);
                                else router.back();
                            },
                        },
                    ])}
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
    meta: { fontSize: 13, color: MUTED, marginTop: 8, fontWeight: '600' },
    label: { marginTop: 22, marginBottom: 8, fontSize: 13, fontWeight: '800', color: MUTED },
    box: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
    boxText: { fontSize: 15, color: INK, lineHeight: 22 },
    attachmentBtn: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    attachment: { fontSize: 12, color: MUTED, fontWeight: '700' },
    attachmentReady: { color: PRIMARY_DARK },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
    linkText: { color: PRIMARY_DARK, fontWeight: '800' },
    input: { backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, minHeight: 90, textAlignVertical: 'top', color: INK, fontWeight: '600' },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0' },
    statusBtnOn: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    statusText: { fontSize: 12, fontWeight: '800', color: MUTED },
    statusTextOn: { color: '#FFF' },
    dangerBtn: { marginTop: 24, backgroundColor: DANGER, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    dangerText: { color: '#FFF', fontWeight: '800' },
});
