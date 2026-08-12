import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '../lib/nexoAlert';
import { useT } from '../lib/i18n';
import {
    MESSAGE_REPORT_REASONS,
    reportMessage,
    type MessageReportReason,
} from '../lib/reportMessage';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const DANGER = '#DC2626';

export default function ReportMessageScreen() {
    const router = useRouter();
    const { t } = useT();
    const { messageId } = useLocalSearchParams<{ messageId?: string }>();
    const scrollRef = useRef<ScrollView>(null);
    const [reason, setReason] = useState<MessageReportReason | null>(null);
    const [details, setDetails] = useState('');
    const [sending, setSending] = useState(false);

    const submit = async () => {
        if (!messageId || !reason) {
            Alert.alert(t('report.notice'), t('report.pickReason'));
            return;
        }

        setSending(true);
        try {
            const { error } = await reportMessage(messageId, reason, details);
            if (error === 'already_reported') {
                Alert.alert(t('report.notice'), t('report.messageAlready'));
            } else if (error === 'message_report_daily_limit') {
                Alert.alert(t('report.notice'), t('report.messageDailyLimit'));
            } else if (error === 'message_not_found_or_forbidden') {
                Alert.alert(t('report.notice'), t('report.messageUnavailable'));
            } else if (error) {
                Alert.alert(t('report.notice'), t('report.messageError'));
            } else {
                Alert.alert(t('report.thanksTitle'), t('report.thanksBody'), [
                    { text: t('common.ok'), onPress: () => router.back() },
                ]);
            }
        } finally {
            setSending(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('report.messageTitle')}</Text>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                >
                    <Text style={styles.lead}>{t('report.messageLead')}</Text>
                    <Text style={styles.label}>{t('report.reason')}</Text>
                    {MESSAGE_REPORT_REASONS.map((key) => {
                        const active = reason === key;
                        return (
                            <Pressable
                                key={key}
                                style={[styles.option, active && styles.optionActive]}
                                onPress={() => setReason(key)}
                            >
                                <View style={[styles.radio, active && styles.radioOn]} />
                                <Text style={[styles.optionText, active && styles.optionTextOn]}>
                                    {t(`report.message.${key}`)}
                                </Text>
                            </Pressable>
                        );
                    })}

                    <Text style={styles.label}>{t('report.messageOptional')}</Text>
                    <TextInput
                        style={styles.input}
                        value={details}
                        onChangeText={(value) => setDetails(value.slice(0, 1000))}
                        onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
                        placeholder={t('report.messagePlaceholder')}
                        placeholderTextColor="#94A3B8"
                        multiline
                        textAlignVertical="top"
                        maxLength={1000}
                    />

                    <TouchableOpacity
                        style={[styles.submit, (!reason || sending) && styles.submitDisabled]}
                        onPress={() => void submit()}
                        disabled={!reason || sending}
                        activeOpacity={0.9}
                    >
                        {sending ? <ActivityIndicator color="#FFF" /> : (
                            <Text style={styles.submitText}>{t('report.send')}</Text>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#F8FAFC' },
    flex: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    title: { fontSize: 17, fontWeight: '800', color: INK },
    content: { paddingHorizontal: 20, paddingBottom: 120, flexGrow: 1 },
    lead: { fontSize: 14, color: MUTED, lineHeight: 21, marginBottom: 20 },
    label: {
        fontSize: 12,
        fontWeight: '800',
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 10,
        marginTop: 8,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#FFF',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: BORDER,
        paddingVertical: 14,
        paddingHorizontal: 14,
        marginBottom: 8,
    },
    optionActive: { borderColor: PRIMARY_DARK, backgroundColor: '#EFF6FF' },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#CBD5E1' },
    radioOn: { borderColor: PRIMARY_DARK, backgroundColor: PRIMARY_DARK },
    optionText: { flex: 1, fontSize: 15, fontWeight: '600', color: INK },
    optionTextOn: { color: PRIMARY_DARK },
    input: {
        minHeight: 110,
        backgroundColor: '#FFF',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: BORDER,
        padding: 14,
        fontSize: 15,
        color: INK,
        marginBottom: 20,
    },
    submit: { backgroundColor: DANGER, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});

