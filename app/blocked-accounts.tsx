import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { getBlockedUsers, unblockUser } from '../lib/blocks';
import { useT } from '../lib/i18n';
import { supabase } from '../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

export default function BlockedAccountsScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState<Awaited<ReturnType<typeof getBlockedUsers>>>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.replace('/login');
                return;
            }
            setUsers(await getBlockedUsers(user.id));
        } catch {
            setUsers([]);
        } finally {
            setLoading(false);
        }
    }, [router]);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    const handleUnblock = (id: string, name: string) => {
        Alert.alert(t('settings.unblock'), t('settings.unblockConfirm', { name }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('settings.unblock'),
                onPress: async () => {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    setBusyId(id);
                    await unblockUser(user.id, id);
                    setBusyId(null);
                    void load();
                },
            },
        ]);
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('settings.blockedAccounts')}</Text>
                <View style={{ width: 45 }} />
            </View>

            {loading ? (
                <ActivityIndicator color={PRIMARY_DARK} style={{ marginTop: 40 }} />
            ) : (
                <FlatList
                    data={users}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        <Text style={styles.empty}>{t('settings.blockedEmpty')}</Text>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <ProfileAvatar uri={item.avatar_url} name={item.nombre} size={48} />
                            <View style={styles.rowInfo}>
                                <Text style={styles.name}>{item.nombre}</Text>
                                {item.nombre_usuario ? (
                                    <Text style={styles.username}>@{item.nombre_usuario}</Text>
                                ) : null}
                            </View>
                            <TouchableOpacity
                                style={styles.unblockBtn}
                                onPress={() => handleUnblock(item.id, item.nombre)}
                                disabled={busyId === item.id}
                            >
                                {busyId === item.id ? (
                                    <ActivityIndicator size="small" color={PRIMARY_DARK} />
                                ) : (
                                    <Text style={styles.unblockText}>{t('settings.unblock')}</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 60 : 44,
        paddingBottom: 14,
    },
    backBtn: {
        width: 45,
        height: 45,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 15,
    },
    title: { fontSize: 20, fontWeight: '900', color: INK },
    list: { paddingHorizontal: 20, paddingBottom: 40 },
    empty: { textAlign: 'center', color: '#94A3B8', marginTop: 40, fontWeight: '600' },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        gap: 12,
    },
    rowInfo: { flex: 1 },
    name: { fontSize: 16, fontWeight: '700', color: INK },
    username: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
    unblockBtn: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
    },
    unblockText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13 },
});
