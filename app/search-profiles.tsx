import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    ActivityIndicator,
    InteractionManager,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { PeopleSearchIcon } from '../components/PeopleSearchIcon';
import { NexoEmptyState } from '../components/ui/NexoState';
import { useAuthSession } from '../lib/authSession';
import { GuestLockedPanel } from '../components/GuestLockedPanel';
import { useT } from '../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../lib/listConfig';
import { searchProfilesByName } from '../lib/profileFields';
import { seedUserProfilePeek, prefetchUserProfile } from '../lib/userProfileCache';
import { type ThemeColors } from '../theme';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';

const INK = '#0F2A4A';

type SearchHit = {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario: string | null;
    es_organizador?: boolean;
};

export default function SearchProfilesScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const { t } = useT();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createSearchStyles);
    const { isGuest, requireAccount, userId } = useAuthSession();
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchHit[]>([]);
    const searchGenRef = useRef(0);
    const inputRef = useRef<TextInput>(null);
    const focusedOnceRef = useRef(false);

    // Enfocar solo cuando la transición ya terminó: con slide el teclado salía de lado;
    // con fade + afterInteractions el teclado siempre sube desde abajo.
    useEffect(() => {
        let cancelled = false;
        let focusTimer: ReturnType<typeof setTimeout> | null = null;
        const focusInput = () => {
            if (cancelled || focusedOnceRef.current) return;
            focusedOnceRef.current = true;
            inputRef.current?.focus();
        };
        const unsub = navigation.addListener('transitionEnd' as never, ((e: { data?: { closing?: boolean } }) => {
            if (e?.data?.closing) return;
            focusTimer = setTimeout(focusInput, 40);
        }) as never);
        const task = InteractionManager.runAfterInteractions(() => {
            // Si transitionEnd no llega (algunos gestos / reaparecer), enfocar tras asentar la UI.
            focusTimer = setTimeout(focusInput, 280);
        });
        return () => {
            cancelled = true;
            unsub();
            task.cancel();
            if (focusTimer) clearTimeout(focusTimer);
        };
    }, [navigation]);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            searchGenRef.current += 1;
            setResults([]);
            setSearching(false);
            return;
        }

        const gen = ++searchGenRef.current;
        setSearching(true);

        const applyRows = (data: Awaited<ReturnType<typeof searchProfilesByName>>) => {
            if (gen !== searchGenRef.current) return;
            setResults(
                data.map((p) => ({
                    id: p.id,
                    nombre: p.nombre || t('profile.user'),
                    avatar_url: p.avatar_url,
                    nombre_usuario: p.nombre_usuario,
                    es_organizador: p.es_organizador === true,
                })),
            );
            setSearching(false);
        };

        const fastTimer = setTimeout(() => {
            void searchProfilesByName(q, userId ?? undefined)
                .then((data) => {
                    applyRows(data);
                    if (gen !== searchGenRef.current) return;
                    if (data.length >= 6 || q.length < 3) return;
                    void searchProfilesByName(q, userId ?? undefined, { deep: true })
                        .then(applyRows)
                        .catch(() => {});
                })
                .catch(() => {
                    if (gen === searchGenRef.current) {
                        setResults([]);
                        setSearching(false);
                    }
                });
        }, 80);

        return () => clearTimeout(fastTimer);
    }, [query, userId, t]);

    const openProfile = useCallback(
        (item: SearchHit) => {
            if (requireAccount({ type: 'view-profile', userId: item.id })) return;
            seedUserProfilePeek({
                id: item.id,
                nombre: item.nombre,
                nombre_usuario: item.nombre_usuario,
                avatar_url: item.avatar_url,
                es_organizador: item.es_organizador === true,
            });
            prefetchUserProfile(item.id);
            router.push({ pathname: '/user-profile/[id]', params: { id: item.id } });
        },
        [requireAccount, router],
    );

    const searchingNow = query.trim().length >= 2;

    if (isGuest) {
        return (
            <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
                <View style={styles.pageHeader}>
                    <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
                        <Ionicons name="chevron-back" size={26} color={INK} />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                </View>
                <GuestLockedPanel intent={{ type: 'search' }} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <View style={styles.pageHeader}>
                <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={26} color={INK} />
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
            </View>

            <View style={styles.searchBox}>
                <PeopleSearchIcon size={20} color={colors.primary} />
                <TextInput
                    ref={inputRef}
                    style={styles.searchInput}
                    placeholder={t('search.placeholder')}
                    placeholderTextColor={colors.textSubtle}
                    keyboardAppearance={scheme}
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                />
                {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>

            <View style={{ flex: 1 }}>
                {!searchingNow ? (
                    <NexoEmptyState
                        icon="search-outline"
                        title={t('search.instagramHint')}
                        style={{ paddingTop: 48 }}
                    />
                ) : results.length === 0 && !searching ? (
                    <NexoEmptyState
                        icon="person-outline"
                        title={t('search.noResults')}
                        style={{ paddingTop: 48 }}
                    />
                ) : (
                    <FlashList
                        data={results}
                        keyExtractor={(item) => item.id}
                        drawDistance={FLASH_LIST_DRAW_DISTANCE}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.row}
                                onPress={() => openProfile(item)}
                                activeOpacity={0.85}
                            >
                                <ProfileAvatar
                                    uri={item.avatar_url}
                                    name={item.nombre}
                                    size={52}
                                    recyclingKey={item.id}
                                />
                                <View style={styles.rowCopy}>
                                    <Text style={styles.rowName} numberOfLines={1}>
                                        {item.nombre}
                                    </Text>
                                </View>
                                {item.es_organizador ? (
                                    <View style={styles.orgPill}>
                                        <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                                    </View>
                                ) : null}
                            </TouchableOpacity>
                        )}
                    />
                )}
            </View>
        </SafeAreaView>
    );
}

function createSearchStyles(c: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.background },
        pageHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
            paddingVertical: 8,
        },
        backBtn: {
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
        },
        pageTitle: { fontSize: 18, fontWeight: '800', color: INK },
        searchBox: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 14,
            paddingHorizontal: 14,
            height: 44,
            marginHorizontal: 16,
            marginBottom: 8,
        },
        searchInput: { flex: 1, fontSize: 16, color: INK, paddingVertical: 0 },
        listContent: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 10,
        },
        rowCopy: { flex: 1, minWidth: 0 },
        rowName: { fontSize: 15, fontWeight: '800', color: INK },
        rowUser: { fontSize: 13, fontWeight: '600', color: c.textMuted, marginTop: 2 },
        orgPill: { paddingLeft: 4 },
    });
}
