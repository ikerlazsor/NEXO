import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../lib/listConfig';
import { getOrganizerMembers } from '../lib/organizer';
import { theme } from '../theme';

const INK = '#0F2A4A';

type Member = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
};

export default function OrganizerMembersScreen() {
    const router = useRouter();
    const { t } = useT();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const organizerId = typeof id === 'string' ? id : '';
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [members, setMembers] = useState<Member[]>([]);

    const load = useCallback(async (soft = false) => {
        if (!organizerId) {
            setMembers([]);
            setLoading(false);
            setRefreshing(false);
            return;
        }
        if (!soft) setLoading(true);
        const rows = await getOrganizerMembers(organizerId);
        setMembers(rows);
        setLoading(false);
        setRefreshing(false);
    }, [organizerId]);

    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    return (
        <View style={styles.root}>
            <LinearGradient colors={['#DBEAFE', theme.colors.backgroundAlt]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <ScreenHeader compact embedded title={t('organizer.membersTitle')} onBack={() => router.back()} />
                {loading ? (
                    <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
                ) : (
                    <FlashList
                        data={members}
                        keyExtractor={(item) => item.id}
                        style={{ flex: 1 }}
                        drawDistance={FLASH_LIST_DRAW_DISTANCE}
                        contentContainerStyle={styles.list}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={() => {
                                    setRefreshing(true);
                                    void load(true);
                                }}
                                tintColor={theme.colors.primary}
                            />
                        }
                        ListEmptyComponent={
                            <View style={styles.empty}>
                                <Ionicons name="people-outline" size={36} color="#94A3B8" />
                                <Text style={styles.emptyTitle}>{t('organizer.membersEmpty')}</Text>
                            </View>
                        }
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.row}
                                activeOpacity={0.85}
                                onPress={() => router.push({ pathname: '/user-profile/[id]', params: { id: item.id } })}
                            >
                                <ProfileAvatar
                                    uri={item.avatar_url}
                                    name={item.nombre || t('profile.user')}
                                    size={48}
                                    recyclingKey={item.id}
                                />
                                <View style={styles.rowText}>
                                    <Text style={styles.name} numberOfLines={1}>
                                        {item.nombre || t('profile.user')}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                        )}
                    />
                )}
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.backgroundAlt },
    list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    rowText: { flex: 1, minWidth: 0 },
    name: { fontSize: 16, fontWeight: '800', color: INK },
    handle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#64748B' },
    empty: { alignItems: 'center', paddingTop: 64, gap: 12, paddingHorizontal: 24 },
    emptyTitle: { color: '#64748B', fontWeight: '700', fontSize: 15, textAlign: 'center' },
});
