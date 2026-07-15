import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { countUnlockedBadges } from '../lib/badges';
import { getBadgeStats } from '../lib/badgeStats';
import { useT } from '../lib/i18n';
import { searchProfilesByUsername } from '../lib/profileFields';
import { supabase } from '../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

type RankKey = 'friends' | 'plans' | 'badges';

type RankedProfile = {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario: string | null;
    score: number;
};

export default function SearchProfilesScreen() {
    const router = useRouter();
    const { t } = useT();
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<RankedProfile[]>([]);
    const [rankKey, setRankKey] = useState<RankKey>('friends');
    const [rankings, setRankings] = useState<RankedProfile[]>([]);
    const [loadingRankings, setLoadingRankings] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    const loadRankings = useCallback(async (key: RankKey) => {
        setLoadingRankings(true);
        try {
            const fieldMap = {
                friends: 'numero_amistades',
                plans: 'numero_planes_realizados',
                badges: 'numero_planes_realizados',
            } as const;

            const { data, error } = await supabase
                .from('estadisticas_usuario')
                .select(`
                    valoracion_media,
                    porcentaje_repetiria,
                    numero_valoraciones,
                    numero_planes_realizados,
                    numero_amistades,
                    usuario_id,
                    perfiles:usuario_id ( id, nombre, avatar_url, nombre_usuario )
                `)
                .order(fieldMap[key], { ascending: false })
                .limit(key === 'badges' ? 15 : 10);

            if (error) throw error;

            let mapped: RankedProfile[] = await Promise.all((data ?? []).map(async (row) => {
                const raw = row.perfiles;
                const profile = Array.isArray(raw) ? raw[0] : raw;
                let score = 0;

                if (key === 'badges') {
                    const stats = await getBadgeStats(row.usuario_id as string);
                    score = countUnlockedBadges(stats);
                } else if (key === 'friends') {
                    score = row.numero_amistades ?? 0;
                } else {
                    score = row.numero_planes_realizados ?? 0;
                }

                return {
                    id: (profile?.id as string) ?? (row.usuario_id as string),
                    nombre: (profile?.nombre as string) || t('profile.user'),
                    avatar_url: (profile?.avatar_url as string | null) ?? null,
                    nombre_usuario: (profile?.nombre_usuario as string | null) ?? null,
                    score,
                };
            }));

            mapped = mapped.filter((p) => p.id);
            if (key === 'badges') {
                mapped = mapped.sort((a, b) => b.score - a.score).slice(0, 10);
            }

            setRankings(mapped);
        } catch {
            setRankings([]);
        } finally {
            setLoadingRankings(false);
        }
    }, [t]);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
    }, []);

    useEffect(() => {
        void loadRankings(rankKey);
    }, [rankKey, loadRankings]);

    useEffect(() => {
        const run = async () => {
            if (query.trim().length < 2) {
                setResults([]);
                return;
            }
            setSearching(true);
            try {
                const data = await searchProfilesByUsername(query, currentUserId ?? undefined);
                setResults(data.map((p) => ({
                    id: p.id,
                    nombre: p.nombre || t('profile.user'),
                    avatar_url: p.avatar_url,
                    nombre_usuario: p.nombre_usuario,
                    score: 0,
                })));
            } catch {
                setResults([]);
            } finally {
                setSearching(false);
            }
        };
        const timer = setTimeout(run, 300);
        return () => clearTimeout(timer);
    }, [query, currentUserId, t]);

    const rankLabels: Record<RankKey, string> = {
        friends: t('search.rankFriends'),
        plans: t('search.rankPlans'),
        badges: t('search.rankBadges'),
    };

    const renderProfileRow = (item: RankedProfile, index?: number) => (
        <TouchableOpacity
            key={item.id}
            style={styles.profileRow}
            onPress={() => router.push({ pathname: '/user-profile/[id]', params: { id: item.id } })}
            activeOpacity={0.85}
        >
            {index != null && (
                <Text style={styles.rankNum}>{index + 1}</Text>
            )}
            <ProfileAvatar uri={item.avatar_url} name={item.nombre} size={44} />
            <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{item.nombre}</Text>
                {item.nombre_usuario ? (
                    <Text style={styles.profileUser}>@{item.nombre_usuario}</Text>
                ) : null}
            </View>
            {item.score > 0 && (
                <View style={styles.scoreBadge}>
                    <Text style={styles.scoreText}>{item.score}</Text>
                </View>
            )}
            <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('search.title')}</Text>
                <View style={{ width: 45 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={20} color={PRIMARY_DARK} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t('search.placeholder')}
                        placeholderTextColor="#94A3B8"
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {searching && <ActivityIndicator size="small" color={PRIMARY_DARK} />}
                </View>

                {query.trim().length >= 2 && (
                    <View style={styles.section}>
                        {results.length === 0 && !searching ? (
                            <Text style={styles.empty}>{t('search.noResults')}</Text>
                        ) : (
                            results.map((r) => renderProfileRow(r))
                        )}
                    </View>
                )}

                <Text style={styles.sectionTitle}>{t('search.rankings')}</Text>
                <View style={styles.rankTabs}>
                    {(['friends', 'plans', 'badges'] as RankKey[]).map((key) => (
                        <TouchableOpacity
                            key={key}
                            style={[styles.rankTab, rankKey === key && styles.rankTabActive]}
                            onPress={() => setRankKey(key)}
                        >
                            <Text style={[styles.rankTabText, rankKey === key && styles.rankTabTextActive]}>
                                {rankLabels[key]}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <View style={styles.section}>
                    {loadingRankings ? (
                        <ActivityIndicator color={PRIMARY_DARK} style={{ marginVertical: 20 }} />
                    ) : rankings.length === 0 ? (
                        <Text style={styles.empty}>{t('search.noResults')}</Text>
                    ) : (
                        rankings.map((r, i) => renderProfileRow(r, i))
                    )}
                </View>
            </ScrollView>
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
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 16,
    },
    searchInput: { flex: 1, fontSize: 16, color: INK },
    section: { marginBottom: 20 },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#94A3B8',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 10,
    },
    rankTabs: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
    rankTab: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    rankTabActive: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    rankTabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
    rankTabTextActive: { color: '#FFF' },
    profileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 14,
        padding: 12,
        marginBottom: 8,
        gap: 10,
    },
    rankNum: { width: 22, fontSize: 15, fontWeight: '900', color: PRIMARY_DARK, textAlign: 'center' },
    profileInfo: { flex: 1 },
    profileName: { fontSize: 15, fontWeight: '700', color: INK },
    profileUser: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
    scoreBadge: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
    },
    scoreText: { fontSize: 13, fontWeight: '800', color: PRIMARY_DARK },
    empty: { textAlign: 'center', color: '#94A3B8', paddingVertical: 16, fontWeight: '600' },
});
