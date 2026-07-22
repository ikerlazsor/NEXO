import {
    useCallback,
    useEffect,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    registerNexoAlertPresenter,
    type NexoAlertButton,
    type NexoAlertRequest,
} from '../lib/nexoAlert';

const INK = '#0F2A4A';
const MUTED = '#64748B';
const PRIMARY_DARK = '#2563EB';
const DANGER = '#EF4444';
const CARD = '#FFFFFF';
const BACKDROP = 'rgba(15, 42, 74, 0.45)';

type Props = { children: React.ReactNode };

export function NexoAlertHost({ children }: Props) {
    const [queue, setQueue] = useState<NexoAlertRequest[]>([]);
    const [busy, setBusy] = useState(false);
    const closingRef = useRef(false);

    const current = queue[0] ?? null;

    useEffect(() => {
        registerNexoAlertPresenter((req) => {
            setQueue((prev) => [...prev, req]);
        });
        return () => registerNexoAlertPresenter(null);
    }, []);

    const dismiss = useCallback(() => {
        closingRef.current = false;
        setBusy(false);
        setQueue((prev) => prev.slice(1));
    }, []);

    const runButton = useCallback(
        async (btn: NexoAlertButton) => {
            if (closingRef.current || busy) return;
            closingRef.current = true;
            try {
                if (btn.onPress) {
                    setBusy(true);
                    await btn.onPress();
                }
            } finally {
                dismiss();
            }
        },
        [busy, dismiss],
    );

    const onBackdrop = () => {
        if (!current || busy) return;
        if (current.options?.cancelable === false) return;
        const cancelBtn = current.buttons.find((b) => b.style === 'cancel');
        if (cancelBtn) {
            void runButton(cancelBtn);
            return;
        }
        if (current.buttons.length === 1) {
            void runButton(current.buttons[0]);
        }
    };

    const buttons = current?.buttons ?? [];
    const stacked = buttons.length > 2;

    return (
        <>
            {children}
            <Modal
                visible={!!current}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={onBackdrop}
            >
                <Pressable style={styles.backdrop} onPress={onBackdrop}>
                    <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
                        {current ? (
                            <>
                                <Text style={styles.title}>{current.title}</Text>
                                {current.message ? (
                                    <Text style={styles.message}>{current.message}</Text>
                                ) : null}

                                <View style={[styles.actions, stacked && styles.actionsStacked]}>
                                    {buttons.map((btn, index) => {
                                        const style = btn.style ?? 'default';
                                        const isDestructive = style === 'destructive';
                                        const isCancel = style === 'cancel';
                                        const isPrimary = !isDestructive && !isCancel;
                                        return (
                                            <TouchableOpacity
                                                key={`${btn.text}-${index}`}
                                                style={[
                                                    styles.btn,
                                                    stacked && styles.btnFull,
                                                    isPrimary && styles.btnPrimary,
                                                    isCancel && styles.btnCancel,
                                                    isDestructive && styles.btnDestructive,
                                                    busy && styles.btnDisabled,
                                                ]}
                                                activeOpacity={0.85}
                                                disabled={busy}
                                                onPress={() => void runButton(btn)}
                                            >
                                                {busy && isPrimary ? (
                                                    <ActivityIndicator color="#FFF" size="small" />
                                                ) : (
                                                    <Text
                                                        style={[
                                                            styles.btnText,
                                                            isPrimary && styles.btnTextPrimary,
                                                            isCancel && styles.btnTextCancel,
                                                            isDestructive && styles.btnTextDestructive,
                                                        ]}
                                                    >
                                                        {btn.text}
                                                    </Text>
                                                )}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </>
                        ) : null}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: BACKDROP,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
    },
    card: {
        width: '100%',
        maxWidth: 340,
        backgroundColor: CARD,
        borderRadius: 22,
        paddingTop: 22,
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderWidth: 1,
        borderColor: '#E8EEF5',
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '900',
        color: INK,
        textAlign: 'center',
        letterSpacing: -0.2,
    },
    message: {
        marginTop: 10,
        fontSize: 14,
        fontWeight: '600',
        color: MUTED,
        textAlign: 'center',
        lineHeight: 20,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 20,
    },
    actionsStacked: {
        flexDirection: 'column',
    },
    btn: {
        flex: 1,
        minHeight: 46,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    btnFull: {
        flex: 0,
        width: '100%',
    },
    btnPrimary: {
        backgroundColor: PRIMARY_DARK,
    },
    btnCancel: {
        backgroundColor: '#F1F5F9',
    },
    btnDestructive: {
        backgroundColor: '#FEE2E2',
    },
    btnDisabled: {
        opacity: 0.7,
    },
    btnText: {
        fontSize: 15,
        fontWeight: '800',
    },
    btnTextPrimary: {
        color: '#FFF',
    },
    btnTextCancel: {
        color: INK,
    },
    btnTextDestructive: {
        color: DANGER,
    },
});
