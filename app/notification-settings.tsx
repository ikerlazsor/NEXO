import {
    Ionicons
} from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
    useFocusEffect,
    useRouter
} from 'expo-router';
import {
    useCallback,
    useEffect,
    useState
} from 'react';
import {
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { hapticToggle, hapticWarning } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { Alert } from '../lib/nexoAlert';
import {
    getNotificationCategoryPrefs,
    peekNotificationCategoryPrefs,
    setNotificationCategoryPrefs,
    syncNotificationCategoryPrefsFromServer,
    type NotificationCategoryPrefs,
} from '../lib/notificationPrefs';
import {
    cancelAllScheduledNexoNotifications,
    enablePushWithPermission,
    getNotificationPermissionStatus,
    openSystemNotificationSettings,
    peekPushPreference,
    setPushPreference,
    syncPushPreferenceFromServer,
} from '../lib/push';
import { type ThemeColors } from '../theme';

type RowProps = {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    right?: React.ReactNode;
};

const Row = ({ icon, label, right }: RowProps) => {
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name={icon} size={20} color={colors.primary} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text, flex: 1 }]}>{label}</Text>
            {right}
        </View>
    );
};

export default function NotificationSettingsScreen() {
    const router = useRouter();
    const { t } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const [userId, setUserId] = useState<string | null>(null);
    const [osDenied, setOsDenied] = useState(false);
    const [catPrefs, setCatPrefs] = useState<NotificationCategoryPrefs>(() => peekNotificationCategoryPrefs());

    const refresh = useCallback(async (uid: string | null) => {
        const [pref, perm, cats] = await Promise.all([
            uid ? syncPushPreferenceFromServer(uid) : Promise.resolve(peekPushPreference()),
            getNotificationPermissionStatus(),
            uid ? syncNotificationCategoryPrefsFromServer(uid) : getNotificationCategoryPrefs(),
        ]);
        void pref;
        setOsDenied(perm === 'denied');
        setCatPrefs(cats);
    }, []);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const user = await getAuthUser();
            const uid = user?.id ?? null;
            if (!alive) return;
            setUserId(uid);
            await refresh(uid);
        })();
        return () => {
            alive = false;
        };
    }, [refresh]);

    useFocusEffect(
        useCallback(() => {
            void refresh(userId);
        }, [refresh, userId]),
    );

    const handleCategoryToggle = async (key: keyof NotificationCategoryPrefs, value: boolean) => {
        hapticToggle(value);
        const next = { ...catPrefs, [key]: value };
        setCatPrefs(next);

        if (value) {
            const result = await enablePushWithPermission(userId ?? undefined);
            if (result.denied) {
                setOsDenied(true);
                hapticWarning();
                Alert.alert(t('settings.notifPermissionDenied'), t('settings.notifPermissionBody'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('settings.notifOpenSettings'),
                        onPress: () => {
                            void openSystemNotificationSettings();
                        },
                    },
                ]);
                return;
            }
            setOsDenied(false);
        } else if (!next.messages && !next.social && !next.reminders) {
            await setPushPreference(false, userId ?? undefined);
        }

        await setNotificationCategoryPrefs(next, userId ?? undefined);
        if (key === 'reminders' && !value) {
            await cancelAllScheduledNexoNotifications();
        }
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <ScreenHeader compact embedded title={t('settings.notifications')} onBack={() => router.back()} />
                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    {osDenied ? (
                        <View style={[styles.card, { marginBottom: 14 }]}>
                            <Row
                                icon="warning-outline"
                                label={t('settings.notifPermissionDenied')}
                                right={
                                    <Text
                                        style={{ color: colors.brand, fontWeight: '700', fontSize: 13 }}
                                        onPress={() => {
                                            void openSystemNotificationSettings();
                                        }}
                                    >
                                        {t('settings.notifOpenSettings')}
                                    </Text>
                                }
                            />
                        </View>
                    ) : null}
                    <View style={styles.card}>
                        <Row
                            icon="chatbubbles-outline"
                            label={t('settings.notifMessages')}
                            right={
                                <Switch
                                    value={catPrefs.messages}
                                    onValueChange={(v) => {
                                        void handleCategoryToggle('messages', v);
                                    }}
                                    trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                    thumbColor={colors.onPrimary}
                                />
                            }
                        />
                        <View style={styles.divider} />
                        <Row
                            icon="people-outline"
                            label={t('settings.notifSocial')}
                            right={
                                <Switch
                                    value={catPrefs.social}
                                    onValueChange={(v) => {
                                        void handleCategoryToggle('social', v);
                                    }}
                                    trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                    thumbColor={colors.onPrimary}
                                />
                            }
                        />
                        <View style={styles.divider} />
                        <Row
                            icon="alarm-outline"
                            label={t('settings.notifReminders')}
                            right={
                                <Switch
                                    value={catPrefs.reminders}
                                    onValueChange={(v) => {
                                        void handleCategoryToggle('reminders', v);
                                    }}
                                    trackColor={{ true: colors.brand, false: colors.borderStrong }}
                                    thumbColor={colors.onPrimary}
                                />
                            }
                        />
                    </View>
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.backgroundAlt },
        content: { paddingHorizontal: 20, paddingBottom: 40 },
        card: {
            backgroundColor: c.surface,
            borderRadius: 20,
            overflow: 'hidden',
            elevation: 3,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
        },
        row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
        rowIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
        rowLabel: { fontSize: 16, fontWeight: '600' },
        divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 68 },
    });
}
