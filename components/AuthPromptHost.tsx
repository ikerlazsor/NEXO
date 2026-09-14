import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { guestCopyKeys, setPendingAuthIntent, type AuthIntent } from '../lib/authIntent';
import { registerAuthPromptPresenter } from '../lib/authPrompt';
import { hapticLight, hapticMedium } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';

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

    return (
        <Modal
            visible={!!intent}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={close}
        >
            <Pressable style={styles.backdrop} onPress={close}>
                <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
                    {copy ? (
                        <>
                            <Text style={styles.title}>{t(copy.title)}</Text>
                            {intent?.type === 'create-plan' ? null : (
                                <Text style={styles.body}>{t(copy.body)}</Text>
                            )}
                            <TouchableOpacity
                                style={styles.primary}
                                onPress={() => goLogin(true)}
                                activeOpacity={0.88}
                            >
                                <Text style={styles.primaryText}>{t('login.tabRegister')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.secondary}
                                onPress={() => goLogin(false)}
                                activeOpacity={0.88}
                            >
                                <Text style={styles.secondaryText}>{t('login.tabLogin')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.cancel} onPress={close} activeOpacity={0.8}>
                                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                        </>
                    ) : null}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function createAuthPromptStyles(c: ThemeColors) {
    return StyleSheet.create({
        backdrop: {
            flex: 1,
            backgroundColor: c.overlay,
            justifyContent: 'flex-end',
            padding: 16,
        },
        card: {
            backgroundColor: c.surface,
            borderRadius: 24,
            paddingHorizontal: 22,
            paddingTop: 26,
            paddingBottom: 18,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
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
