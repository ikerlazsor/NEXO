import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '../../../lib/nexoAlert';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useT } from '../../../lib/i18n';
import { fetchAccountAccess } from '../../../lib/roles';
import { reviewOrganizerRequest, organizerTypeKey, type OrganizerRequest } from '../../../lib/organizer';
import { supabase } from '../../../lib/supabase';
import { theme } from '../../../theme';

export default function AdminOrganizerRequestScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t } = useT();
    const [row, setRow] = useState<OrganizerRequest | null>(null);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const access = await fetchAccountAccess();
        if (!access.isStaff) {
            setLoading(false);
            return;
        }
        const selectFull =
            'id, usuario_id, nombre_org, tipo, ciudad, web, instagram, whatsapp, descripcion, informacion, logo_url, cover_url, motivo, estado, notas_internas, creado_en, perfil:perfiles!usuario_id(nombre, nombre_usuario, avatar_url)';
        const selectLegacy =
            'id, usuario_id, nombre_org, tipo, ciudad, web, instagram, descripcion, motivo, estado, notas_internas, creado_en, perfil:perfiles!usuario_id(nombre, nombre_usuario, avatar_url)';
        let { data } = await supabase.from('solicitudes_organizador').select(selectFull).eq('id', id).maybeSingle();
        if (!data) {
            const fallback = await supabase.from('solicitudes_organizador').select(selectLegacy).eq('id', id).maybeSingle();
            data = fallback.data;
        }
        setRow((data as OrganizerRequest | null) ?? null);
        setNotes((data as OrganizerRequest | null)?.notas_internas ?? '');
        setLoading(false);
    }, [id]);

    useEffect(() => {
        void load();
    }, [load]);

    const decide = async (estado: 'aprobado' | 'rechazado') => {
        if (!row || saving) return;
        setSaving(true);
        const { error } = await reviewOrganizerRequest(row.id, estado, notes);
        setSaving(false);
        if (error) {
            Alert.alert(t('admin.error'), error);
            return;
        }
        router.back();
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('organizer.adminTitle')} onBack={() => router.back()} />
            {loading ? (
                <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
            ) : !row ? (
                <Text style={styles.empty}>{t('admin.notFound')}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.content}>
                    <Text style={styles.name}>{row.nombre_org}</Text>
                    <Text style={styles.meta}>
                        {row.perfil?.nombre || '—'} · {t(organizerTypeKey(row.tipo))}
                    </Text>
                    {row.ciudad ? <Text style={styles.meta}>{row.ciudad}</Text> : null}
                    {row.web ? <Text style={styles.meta}>{row.web}</Text> : null}
                    {row.instagram ? <Text style={styles.meta}>@{row.instagram}</Text> : null}
                    {row.whatsapp ? <Text style={styles.meta}>{row.whatsapp}</Text> : null}
                    {row.logo_url ? <Image source={{ uri: row.logo_url }} style={styles.logo} /> : null}
                    <Text style={styles.blockTitle}>{t('organizer.fieldAbout')}</Text>
                    <Text style={styles.body}>{row.descripcion}</Text>
                    {row.informacion ? (
                        <>
                            <Text style={styles.blockTitle}>{t('organizer.fieldInfo')}</Text>
                            <Text style={styles.body}>{row.informacion}</Text>
                        </>
                    ) : null}
                    <Text style={styles.blockTitle}>{t('admin.internalNotes')}</Text>
                    <TextInput
                        style={styles.notes}
                        value={notes}
                        onChangeText={setNotes}
                        multiline
                        editable={row.estado === 'pendiente'}
                    />
                    {row.estado === 'pendiente' ? (
                        <View style={styles.actions}>
                            <TouchableOpacity style={styles.reject} onPress={() => void decide('rechazado')} disabled={saving}>
                                <Ionicons name="close" size={18} color="#FFF" />
                                <Text style={styles.actionText}>{t('organizer.reject')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.approve} onPress={() => void decide('aprobado')} disabled={saving}>
                                <Ionicons name="checkmark" size={18} color="#FFF" />
                                <Text style={styles.actionText}>{t('organizer.approve')}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <Text style={styles.status}>{row.estado}</Text>
                    )}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    content: { padding: 20, paddingBottom: 40 },
    name: { fontSize: 24, fontWeight: '900', color: theme.colors.text },
    logo: { width: 72, height: 72, borderRadius: 36, marginTop: 12, backgroundColor: '#E2E8F0' },
    meta: { marginTop: 6, color: theme.colors.textMuted, fontWeight: '600' },
    blockTitle: { marginTop: 18, fontWeight: '800', color: theme.colors.text },
    body: { marginTop: 6, color: theme.colors.textMuted, lineHeight: 21, fontWeight: '600' },
    notes: {
        marginTop: 8,
        minHeight: 80,
        backgroundColor: '#FFF',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        textAlignVertical: 'top',
    },
    actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
    approve: { flex: 1, backgroundColor: theme.colors.success, borderRadius: 14, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
    reject: { flex: 1, backgroundColor: theme.colors.danger, borderRadius: 14, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
    actionText: { color: '#FFF', fontWeight: '800' },
    status: { marginTop: 18, fontWeight: '800', color: theme.colors.textMuted },
    empty: { marginTop: 40, textAlign: 'center', color: theme.colors.textMuted },
});
