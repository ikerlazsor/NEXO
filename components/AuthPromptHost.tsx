import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { guestCopyKeys, setPendingAuthIntent, type AuthIntent } from '../lib/authIntent';
import { registerAuthPromptPresenter } from '../lib/authPrompt';
import { hapticLight, hapticMedium } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';

const PENGUIN_CREATE = require('../assets/images/pinguino al pinchar crear cuenta.png');
const PENGUIN_CHATS = require('../assets/images/Pinguino vacio chats.png');

const PROMPT_PENGUIN_SIZE = 196;
/** Porción del pingüino por encima del borde superior del card. */
const PROMPT_PENGUIN_PERCH = 0.52;

export function AuthPromptHost() {
    const router = useRouter();
    const { t } = useT();
    const styles = useThemedStyles(createAuthPromptStyles);
    const [intent, setIntent] = useState<AuthIntent | null>(null);

    useEffect(() => {
        registerAuthPromptPresenter((next) => setIntent(next));
        return () => registerAuthPromptPresenter(null);
    }, []);

    const close = () => setIntent(null);

    const goLogin = (register: boolean) => {
        if (register) hapticMedium();
        else hapticLight();
        if (intent) void setPendingAuthIntent(intent);
        close();
        router.push({ pathname: '/login', params: { mode: register ? 'register' : 'login' } });
    };

    const copy = intent ? guestCopyKeys(intent) : null;
    const penguinSource = useMemo(() => {
        if (!intent) return null;
        if (intent.type === 'chats') return PENGUIN_CHATS;
        return PENGUIN_CREATE;
    }, [intent]);

    return (
        <Modal
            visible={!!intent}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={close}
        >
            <Pressable style={styles.backdrop} onPress={close}>
                <Pressable style={styles.cardStack} onPress={(e) => e.stopPropagation()}>
                    {penguinSource ? (
                        <View style={styles.penguinPerch} pointerEvents="none">
                            <Image
                                source={penguinSource}
                                style={styles.penguin}
                                contentFit="contain"
                                transition={0}
                            />
                        </View>
                    ) : null}
                    <View style={styles.card}>
                        {copy ? (
                            <>
                                <Text style={styles.title}>{t(copy.title)}</Text>
                                <TouchableOpacity
                                    style={styles.primary}
                                    onPress={() => goLogin(true)}
                                    activeOpacity={0.88}
                                >
                                    <Text style={styles.primaryText}>{t('login.access')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.cancel} onPress={close} activeOpacity={0.8}>
                                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                                </TouchableOpacity>
                            </>
                        ) : null}
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function createAuthPromptStyles(c: ThemeColors) {
    const insidePad = Math.round(PROMPT_PENGUIN_SIZE * (1 - PROMPT_PENGUIN_PERCH)) + 10;
    return StyleSheet.create({
        backdrop: {
            flex: 1,
            backgroundColor: c.overlay,
            justifyContent: 'flex-end',
            padding: 16,
        },
        cardStack: {
            position: 'relative',
            marginTop: PROMPT_PENGUIN_SIZE * PROMPT_PENGUIN_PERCH,
            overflow: 'visible',
        },
        penguinPerch: {
            position: 'absolute',
            top: -(PROMPT_PENGUIN_SIZE * PROMPT_PENGUIN_PERCH),
            left: 0,
            right: 0,
            alignItems: 'center',
            zIndex: 3,
            elevation: 12,
        },
        penguin: {
            width: PROMPT_PENGUIN_SIZE,
            height: PROMPT_PENGUIN_SIZE,
        },
        card: {
            backgroundColor: c.surface,
            borderRadius: 24,
            paddingHorizontal: 22,
            paddingTop: insidePad,
            paddingBottom: 18,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            overflow: 'visible',
            zIndex: 1,
        },
        title: {
            color: c.text,
            fontSize: 22,
            fontWeight: '800',
            textAlign: 'center',
        },
        body: {
            color: c.textMuted,
            fontSize: 15,
            lineHeight: 22,
            marginTop: 10,
            textAlign: 'center',
        },
        primary: {
            marginTop: 22,
            backgroundColor: c.primary,
            borderRadius: 16,
            paddingVertical: 15,
            alignItems: 'center',
        },
        primaryText: { color: c.onPrimary, fontSize: 16, fontWeight: '800' },
        secondary: {
            marginTop: 10,
            backgroundColor: c.primarySoft,
            borderRadius: 16,
            paddingVertical: 15,
            alignItems: 'center',
        },
        secondaryText: { color: c.primary, fontSize: 16, fontWeight: '800' },
        cancel: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
        cancelText: { color: c.textSubtle, fontSize: 14, fontWeight: '600' },
    });
}
