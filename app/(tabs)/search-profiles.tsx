import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { MainChrome } from '../../components/MainChrome';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { getAuthUser } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { searchProfilesByUsername } from '../../lib/profileFields';
import {
    fetchRankings,
    peekRankings,
    type RankKey,
    type RankScope,
    type RankedProfile,
} from '../../lib/rankings';
import { screenCacheKey, ScreenCacheTTL } from '../../lib/screenCaches';
import { cacheSet } from '../../lib/ttlCache';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

type PodiumTier = 'gold' | 'silver' | 'bronze';

const PODIUM: Record<PodiumTier, {
    cardGradient: [string, string, string];
    frameGradient: [string, string, string];
    accent: string;
    scoreBg: string;
    trophySize: number;
    avatarSize: number;
    rankLabel: string;
}> = {
    gold: {
        cardGradient: ['#FFF9E6', '#FFE08A', '#F5C542'],
        frameGradient: ['#FFF4C2', '#FFD700', '#B8860B'],
        accent: '#78350F',
        scoreBg: 'rgba(255,255,255,0.72)',
        trophySize: 22,
        avatarSize: 58,
        rankLabel: '1',
    },
    silver: {
        cardGradient: ['#FFFFFF', '#E8EEF5', '#CBD5E1'],
        frameGradient: ['#F8FAFC', '#CBD5E1', '#64748B'],
        accent: '#334155',
        scoreBg: 'rgba(255,255,255,0.75)',
        trophySize: 18,
        avatarSize: 50,
        rankLabel: '2',
    },
    bronze: {
        cardGradient: ['#FAF0E4', '#E8C9A0', '#CD7F32'],
        frameGradient: ['#F5E6D0', '#CD7F32', '#8B5A2B'],
        accent: '#5C3D1E',
        scoreBg: 'rgba(255,255,255,0.72)',
        trophySize: 18,
        avatarSize: 50,
        rankLabel: '3',
    },
};

function PodiumAvatar({
    uri,
    name,
    tier,
    size,
}: {
    uri: string | null;
    name: string;
    tier: PodiumTier;
    size: number;
}) {
    const config = PODIUM[tier];
    const outer = size + 10;
    return (
        <LinearGradient
            colors={config.frameGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.avatarFrame, { width: outer, height: outer, borderRadius: outer / 2 }]}
        >
            <View style={[styles.avatarFrameInner, { width: size, height: size, borderRadius: size / 2 }]}>
                <ProfileAvatar uri={uri} name={name} size={size} />
            </View>
        </LinearGradient>
    );
}

export default function SearchProfilesScreen() {
    const router = useRouter();
    const { t } = useT();
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<RankedProfile[]>([]);
    const [rankKey, setRankKey] = useState<RankKey>('plans');
    const [rankScope, setRankScope] = useState<RankScope>('global');
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [rankings, setRankings] = useState<RankedProfile[]>([]);
    const [loadingRankings, setLoadingRankings] = useState(true);

    useEffect(() => {
        void getAuthUser().then((user) => {
            const uid = user?.id ?? null;
            setCurrentUserId(uid);
            if (!uid) return;
            const cached = peekRankings(uid, 'plans', 'global');
            if (Array.isArray(cached)) {
                setRankings(cached);
                setLoadingRankings(false);
            }
        });
    }, []);

    const loadRankings = useCallback(async (key: RankKey, scope: RankScope, userId: string | null) => {
        if (userId) {
            const cached = peekRankings(userId, key, scope);
            if (Array.isArray(cached)) {
                setRankings(cached);
                setLoadingRankings(false);
            } else {
                setLoadingRankings(true);
            }
        } else {
            setLoadingRankings(true);
        }

        try {
            const mapped = await fetchRankings(key, scope, {
                userId,
                fallbackName: t('profile.user'),
            });
            setRankings(mapped);
            if (userId) {
                cacheSet(screenCacheKey.rankings(userId, key, scope), mapped, ScreenCacheTTL.rankings);
            }
        } catch {
            if (!userId || peekRankings(userId, key, scope) == null) {
                setRankings([]);
            }
        } finally {
            setLoadingRankings(false);
        }
    }, [t]);

    useEffect(() => {
        void loadRankings(rankKey, rankScope, currentUserId);
    }, [rankKey, rankScope, currentUserId, loadRankings]);

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

    const openProfile = (id: string) => {
        router.push({ pathname: '/user-profile/[id]', params: { id } });
    };

    const renderSearchRow = (item: RankedProfile) => (
        <TouchableOpacity
            key={item.id}
            style={styles.profileRow}
            onPress={() => openProfile(item.id)}
            activeOpacity={0.85}
        >
            <ProfileAvatar uri={item.avatar_url} name={item.nombre} size={44} />
            <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{item.nombre}</Text>
                {item.nombre_usuario ? (
                    <Text style={styles.profileUser}>@{item.nombre_usuario}</Text>
                ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
        </TouchableOpacity>
    );

    const renderPodiumRow = (item: RankedProfile, index: number) => {
        const tier: PodiumTier = index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze';
        const config = PODIUM[tier];
        const isFirst = tier === 'gold';

        return (
            <TouchableOpacity
                key={item.id}
                activeOpacity={0.88}
                onPress={() => openProfile(item.id)}
                style={[styles.podiumWrap, isFirst && styles.podiumWrapFirst]}
            >
                <LinearGradient
                    colors={config.cardGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.podiumCard, isFirst && styles.podiumCardFirst]}
                >
                    <View style={styles.podiumLeft}>
                        <LinearGradient
                            colors={config.frameGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.trophyBadge}
                        >
                            <Ionicons name="trophy" size={config.trophySize} color="#FFF" />
                        </LinearGradient>
                        <Text style={[styles.podiumRank, { color: config.accent }]}>{config.rankLabel}</Text>
                    </View>

                    <PodiumAvatar
                        uri={item.avatar_url}
                        name={item.nombre}
                        tier={tier}
                        size={config.avatarSize}
                    />

                    <View style={styles.profileInfo}>
                        <Text style={[styles.podiumName, { color: config.accent }, isFirst && styles.podiumNameFirst]} numberOfLines={1}>
                            {item.nombre}
                        </Text>
                        {item.nombre_usuario ? (
                            <Text style={[styles.podiumUser, { color: config.accent }]} numberOfLines={1}>
                                @{item.nombre_usuario}
                            </Text>
                        ) : null}
                    </View>

                    <View style={[styles.podiumScore, { backgroundColor: config.scoreBg }]}>
                        <Text style={[styles.podiumScoreText, { color: config.accent }]}>{item.score}</Text>
                    </View>
                </LinearGradient>
            </TouchableOpacity>
        );
    };

    const renderRankingRow = (item: RankedProfile, index: number) => {
        if (index < 3) return renderPodiumRow(item, index);

        return (
            <TouchableOpacity
                key={item.id}
                style={styles.profileRow}
                onPress={() => openProfile(item.id)}
                activeOpacity={0.85}
            >
                <Text style={styles.rankNum}>{index + 1}</Text>
                <ProfileAvatar uri={item.avatar_url} name={item.nombre} size={44} />
                <View style={styles.profileInfo}>
                    <Text style={styles.profileName}>{item.nombre}</Text>
                    {item.nombre_usuario ? (
                        <Text style={styles.profileUser}>@{item.nombre_usuario}</Text>
                    ) : null}
                </View>
                <View style={styles.scoreBadge}>
                    <Text style={styles.scoreText}>{item.score}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
            </TouchableOpacity>
        );
    };

    return (
        <MainChrome active="search">
            <View style={styles.container}>
                <View style={styles.pageHeader}>
                    <Text style={styles.pageTitle}>{t('search.title')}</Text>
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
                                results.map((r) => renderSearchRow(r))
                            )}
                        </View>
                    )}

                    <Text style={styles.sectionTitle}>{t('search.rankings')}</Text>
                    <View style={styles.scopeTabs}>
                        {([
                            { key: 'global' as const, label: t('search.rankScopeGlobal') },
                            { key: 'friends' as const, label: t('search.rankScopeFriends') },
                        ]).map((opt) => (
                            <TouchableOpacity
                                key={opt.key}
                                style={[styles.scopeTab, rankScope === opt.key && styles.scopeTabActive]}
                                onPress={() => setRankScope(opt.key)}
                                activeOpacity={0.85}
                            >
                                <Text style={[styles.scopeTabText, rankScope === opt.key && styles.scopeTabTextActive]}>
                                    {opt.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <View style={styles.rankTabs}>
                        {(['plans', 'badges', 'friends'] as RankKey[]).map((key) => (
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
                            rankings.map((r, i) => renderRankingRow(r, i))
                        )}
                    </View>
                </ScrollView>
            </View>
        </MainChrome>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    pageHeader: {
        paddingHorizontal: 20,
        paddingBottom: 14,
    },
    pageTitle: { fontSize: 22, fontWeight: '900', color: INK },
    content: { paddingHorizontal: 20, paddingBottom: 130 },
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
    scopeTabs: {
        flexDirection: 'row',
        backgroundColor: '#E2E8F0',
        borderRadius: 12,
        padding: 3,
        marginBottom: 12,
    },
    scopeTab: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: 'center',
    },
    scopeTabActive: {
        backgroundColor: '#FFF',
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    scopeTabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
    scopeTabTextActive: { color: PRIMARY_DARK },
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
    rankNum: { width: 28, fontSize: 15, fontWeight: '900', color: PRIMARY_DARK, textAlign: 'center' },
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
    podiumWrap: { marginBottom: 10 },
    podiumWrapFirst: { marginBottom: 14, marginTop: 2 },
    podiumCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.55)',
        shadowColor: '#64748B',
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    podiumCardFirst: {
        paddingVertical: 18,
        paddingHorizontal: 16,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.7)',
        shadowColor: '#B45309',
        shadowOpacity: 0.28,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    podiumLeft: { alignItems: 'center', width: 36 },
    trophyBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    podiumRank: { fontSize: 11, fontWeight: '900', marginTop: 4 },
    avatarFrame: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 2,
    },
    avatarFrameInner: {
        overflow: 'hidden',
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    podiumName: { fontSize: 15, fontWeight: '800' },
    podiumNameFirst: { fontSize: 17, fontWeight: '900' },
    podiumUser: { fontSize: 12, fontWeight: '600', marginTop: 2, opacity: 0.85 },
    podiumScore: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        minWidth: 44,
        alignItems: 'center',
    },
    podiumScoreText: { fontSize: 15, fontWeight: '900' },
});
