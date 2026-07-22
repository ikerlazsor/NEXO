import {
    Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams,
    useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../lib/i18n';
import type { SupportTipo } from '../lib/moderation';
import { submitSupportMessage } from '../lib/support';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

const VALID: SupportTipo[] = ['contacto', 'problema', 'idea', 'denuncia_general'];

export default function SupportMessageScreen() {
    const router = useRouter();
    const { t } = useT();
    const { tipo: tipoParam } = useLocalSearchParams<{ tipo?: string }>();
    const tipo: SupportTipo = VALID.includes(tipoParam as SupportTipo)
        ? (tipoParam as SupportTipo)
        : 'contacto';
    const [asunto, setAsunto] = useState('');
    const [mensaje, setMensaje] = useState('');
    const [sending, setSending] = useState(false);

    const submit = async () => {
        if (!mensaje.trim()) {
            Alert.alert(t('support.notice'), t('support.empty'));
            return;
        }
        setSending(true);
        const { error } = await submitSupportMessage({ tipo, mensaje, asunto });
        setSending(false);
        if (error === 'account_banned') {
            Alert.alert(t('support.notice'), t('banned.body'));
            return;
        }
        if (error) {
            Alert.alert(t('support.notice'), t('support.error'));
            return;
        }
        Alert.alert(t('support.thanksTitle'), t('support.thanksBody'), [
            { text: t('common.ok'), onPress: () => router.back() },
        ]);
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.title}>{t(`admin.tipo.${tipo}`)}</Text>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <Text style={styles.lead}>{t(`support.lead.${tipo}`)}</Text>

                    <Text style={styles.label}>{t('support.subjectOptional')}</Text>
                    <TextInput
                        style={styles.input}
                        value={asunto}
                        onChangeText={setAsunto}
                        placeholder={t('support.subjectPlaceholder')}
                        placeholderTextColor="#94A3B8"
                        maxLength={120}
                    />

                    <Text style={styles.label}>{t('support.message')}</Text>
                    <TextInput
                        style={[styles.input, styles.area]}
                        value={mensaje}
                        onChangeText={setMensaje}
                        placeholder={t('support.messagePlaceholder')}
                        placeholderTextColor="#94A3B8"
                        multiline
                        maxLength={4000}
                    />

                    <TouchableOpacity style={styles.submit} onPress={submit} disabled={sending} activeOpacity={0.85}>
                        {sending ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <Text style={styles.submitText}>{t('support.send')}</Text>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#F8FAFC' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: { fontSize: 18, fontWeight: '900', color: INK },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    lead: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 18 },
    label: { fontSize: 13, fontWeight: '800', color: MUTED, marginBottom: 8, marginTop: 8 },
    input: {
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 14 : 10,
        fontSize: 15,
        fontWeight: '600',
        color: INK,
    },
    area: { minHeight: 140, textAlignVertical: 'top' },
    submit: {
        marginTop: 24,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 14,
        paddingVertical: 15,
        alignItems: 'center',
    },
    submitText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
