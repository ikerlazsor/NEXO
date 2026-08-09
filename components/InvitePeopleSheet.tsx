import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFriends } from '../lib/friends';
import { hapticLight, hapticSelection, hapticSuccess } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { searchProfilesByUsername } from '../lib/profileFields';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';

const INVITE_FRIENDS_TTL_MS = 60_000;
const inviteFriendsKey = (userId: string) => `inviteFriends:${userId}`;

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

export type InviteProfile = {
    id: string;
    nombre: string;
    nombre_usuario: string | null;
    avatar_url: string | null;
    /** Quién envió la invitación (si se conoce). */
    invitedByName?: string | null;
};

export type InviteAddResult = {
    error: string | null;
    /** Si true, no muestra el banner de éxito (p. ej. lista local al crear plan). */
    silent?: boolean;
};

type Props = {
    visible: boolean;
    onClose: () => void;
    currentUserId: string | null;
    selected: InviteProfile[];
    excludeIds?: Set<string>;
    /** Debe resolver con `{ error }` — no abrir Alert (congela si hay Modal abierto). */
    onAdd: (profile: InviteProfile) => void | Promise<void | InviteAddResult>;
    onRemove?: (profileId: string) => void | Promise<void | { error: string | null }>;
    title?: string;
};

const avatarFallback = (name?: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'N')}&background=4DA6FF&color=fff`;

export function InvitePeopleSheet({
    visible,
    onClose,
    currentUserId,
    selected,
    excludeIds,
    onAdd,
    onRemove,
    title,
}: Props) {
    const { t } = useT();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<InviteProfile[]>([]);
    const [friendSuggestions, setFriendSuggestions] = useState<InviteProfile[]>([]);
    const [searching, setSearching] = useState(false);
    const [keyboardH, setKeyboardH] = useState(0);
    const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
    const inFlightRef = useRef<Set<string>>(new Set());
    const rawResultsRef = useRef<InviteProfile[]>([]);
    const searchGenRef = useRef(0);

    const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
    const excludedIds = useMemo(() => {
        const set = new Set(excludeIds ?? []);
        for (const id of selectedIds) set.add(id);
        return set;
    }, [excludeIds, selectedIds]);
    const excludedIdsRef = useRef(excludedIds);
    excludedIdsRef.current = excludedIds;

    const filterOutExcluded = useCallback((list: InviteProfile[]) => {
        const excluded = excludedIdsRef.current;
        return list.filter((p) => !excluded.has(p.id));
    }, []);

    useEffect(() => {
        if (!visible) {
            setQuery('');
            setResults([]);
            rawResultsRef.current = [];
            inFlightRef.current.clear();
            setKeyboardH(0);
            setFeedback(null);
            setSearching(false);
            return;
        }
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const showSub = Keyboard.addListener(showEvent, (e) => {
            setKeyboardH(e.endCoordinates?.height ?? 0);
        });
        const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardH(0));
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, [visible]);

    // Amigos al abrir: sugerencias instantáneas sin esperar a escribir.
    useEffect(() => {
        if (!visible || !currentUserId) {
            setFriendSuggestions([]);
            return;
        }
        let cancelled = false;
        const cached = cacheGetStale<InviteProfile[]>(inviteFriendsKey(currentUserId));
        if (cached?.length) setFriendSuggestions(cached);
        void getFriends(currentUserId)
            .then((friends) => {
                if (cancelled) return;
                const mapped = friends.map((f) => ({
                    id: f.id,
                    nombre: f.nombre,
                    nombre_usuario: f.nombre_usuario ?? null,
                    avatar_url: f.avatar_url,
                }));
                setFriendSuggestions(mapped);
                cacheSet(inviteFriendsKey(currentUserId), mapped, INVITE_FRIENDS_TTL_MS);
            })
            .catch(() => {
                if (!cancelled && !cached?.length) setFriendSuggestions([]);
            });
        return () => {
            cancelled = true;
        };
    }, [visible, currentUserId]);

    // Al invitar/quitar alguien, filtrar en cliente sin volver a pedir a la red.
    useEffect(() => {
        if (!visible) return;
        if (query.trim().length >= 2) {
            setResults(filterOutExcluded(rawResultsRef.current));
        }
    }, [visible, query, filterOutExcluded, excludedIds]);

    useEffect(() => {
        if (!visible) return;
        const q = query.trim();
        if (q.length < 2) {
            setResults([]);
            rawResultsRef.current = [];
            setSearching(false);
            return;
        }
        const gen = ++searchGenRef.current;
        setSearching(true);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const data = await searchProfilesByUsername(q, currentUserId ?? undefined);
                    if (gen !== searchGenRef.current) return;
                    const mapped = data.map((p) => ({
                        id: p.id,
                        nombre: p.nombre || t('profile.user'),
                        nombre_usuario: p.nombre_usuario,
                        avatar_url: p.avatar_url,
                    }));
                    rawResultsRef.current = mapped;
                    setResults(filterOutExcluded(mapped));
                } catch {
                    if (gen !== searchGenRef.current) return;
                    rawResultsRef.current = [];
                    setResults([]);
                } finally {
                    if (gen === searchGenRef.current) setSearching(false);
                }
            })();
        }, 120);
        return () => {
            clearTimeout(timer);
        };
        // No depende de invitados/excluidos: eso se filtra en cliente arriba.
    }, [query, visible, currentUserId, t, filterOutExcluded]);

    const handleAdd = useCallback(
        async (profile: InviteProfile) => {
            if (inFlightRef.current.has(profile.id)) return;
            inFlightRef.current.add(profile.id);
            hapticSelection();
            setFeedback(null);
            Keyboard.dismiss();
            setResults((prev) => prev.filter((p) => p.id !== profile.id));
            try {
                const result = await onAdd(profile);
                const error = result && typeof result === 'object' ? result.error : null;
                const silent = !!(result && typeof result === 'object' && result.silent);
                if (error === 'already_member' || error === 'already_invited') {
                    setResults((prev) => (prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev]));
                    setFeedback({ ok: false, text: t('friends.inviteAlready') });
                    return;
                }
                if (error) {
                    setResults((prev) => (prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev]));
                    setFeedback({
                        ok: false,
                        text: error.includes('invitacion') || error.includes('plan_invitaciones')
                            ? t('friends.invitesSqlHint')
                            : t('chat.inviteError'),
                    });
                    return;
                }
                if (!silent) {
                    hapticSuccess();
                    setFeedback({ ok: true, text: t('invite.sentOk') });
                }
            } catch {
                setResults((prev) => (prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev]));
                setFeedback({ ok: false, text: t('chat.inviteError') });
            } finally {
                inFlightRef.current.delete(profile.id);
            }
        },
        [onAdd, t],
    );

    const handleRemove = useCallback(
        async (profileId: string) => {
            if (!onRemove || inFlightRef.current.has(profileId)) return;
            inFlightRef.current.add(profileId);
            hapticLight();
            setFeedback(null);
            try {
                const result = await onRemove(profileId);
                const error = result && typeof result === 'object' ? result.error : null;
                if (error) {
                    setFeedback({ ok: false, text: t('invite.removeError') });
                    return;
                }
                setFeedback({ ok: true, text: t('invite.removedOk') });
            } catch {
                setFeedback({ ok: false, text: t('invite.removeError') });
            } finally {
                inFlightRef.current.delete(profileId);
            }
        },
        [onRemove, t],
    );

    const openProfile = useCallback(
        (profileId: string) => {
            onClose();
            requestAnimationFrame(() => {
                router.push(`/user-profile/${profileId}`);
            });
        },
        [onClose, router],
    );

    const bottomPad = Math.max(insets.bottom, 16) + (Platform.OS === 'android' ? keyboardH : 0);
    const showFriendSuggestions = query.trim().length < 2;
    const suggestionList = useMemo(
        () => (showFriendSuggestions ? filterOutExcluded(friendSuggestions) : []),
        [showFriendSuggestions, filterOutExcluded, friendSuggestions],
    );
    const listData = showFriendSuggestions ? suggestionList : results;

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
            >
                <View style={styles.overlay}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                    <View style={[styles.sheet, { paddingBottom: bottomPad, maxHeight: keyboardH > 0 ? '92%' : '88%' }]}>
                        <View style={styles.handle} />
                        <View style={styles.headerRow}>
                            <Text style={styles.title}>{title || t('invite.sheetTitle')}</Text>
                            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                                <Ionicons name="close" size={22} color={INK} />
                            </TouchableOpacity>
                        </View>

                        {feedback ? (
                            <View style={[styles.feedback, feedback.ok ? styles.feedbackOk : styles.feedbackErr]}>
                                <Ionicons
                                    name={feedback.ok ? 'checkmark-circle' : 'alert-circle'}
                                    size={16}
                                    color={feedback.ok ? '#15803D' : '#B91C1C'}
                                />
                                <Text style={[styles.feedbackText, feedback.ok ? styles.feedbackTextOk : styles.feedbackTextErr]}>
                                    {feedback.text}
                                </Text>
                            </View>
                        ) : null}

                        {selected.length > 0 ? (
                            <View style={styles.selectedBlock}>
                                <Text style={styles.sectionLabel}>{t('invite.invitedList')}</Text>
                                <FlatList
                                    horizontal
                                    data={selected}
                                    keyExtractor={(item) => item.id}
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.selectedList}
                                    keyboardShouldPersistTaps="handled"
                                    renderItem={({ item }) => (
                                        <View style={styles.selectedChip}>
                                            <TouchableOpacity
                                                style={styles.selectedChipTap}
                                                onPress={() => openProfile(item.id)}
                                                activeOpacity={0.85}
                                            >
                                                <Image
                                                    source={{ uri: item.avatar_url || avatarFallback(item.nombre) }}
                                                    style={styles.selectedAvatar}
                                                />
                                                <View style={styles.selectedTextCol}>
                                                    <Text style={styles.selectedName} numberOfLines={1}>
                                                        {item.nombre_usuario ? `@${item.nombre_usuario}` : item.nombre}
                                                    </Text>
                                                    {item.invitedByName ? (
                                                        <Text style={styles.selectedBy} numberOfLines={1}>
                                                            {t('invite.invitedBy', { name: item.invitedByName })}
                                                        </Text>
                                                    ) : null}
                                                </View>
                                            </TouchableOpacity>
                                            {onRemove ? (
                                                <TouchableOpacity
                                                    onPress={() => void handleRemove(item.id)}
                                                    hitSlop={8}
                                                >
                                                    <Ionicons name="close-circle" size={18} color="#94A3B8" />
                                                </TouchableOpacity>
                                            ) : null}
                                        </View>
                                    )}
                                />
                            </View>
                        ) : (
                            <Text style={styles.emptySelected}>{t('invite.noneYet')}</Text>
                        )}

                        <View style={styles.searchWrap}>
                            <Ionicons name="search" size={18} color="#94A3B8" />
                            <TextInput
                                style={styles.searchInput}
                                placeholder={t('invite.searchPlaceholder')}
                                placeholderTextColor="#94A3B8"
                                value={query}
                                onChangeText={setQuery}
                                autoCapitalize="none"
                                autoCorrect={false}
                                returnKeyType="search"
                            />
                            {searching ? <ActivityIndicator size="small" color={PRIMARY} /> : null}
                        </View>

                        <FlatList
                            data={listData}
                            keyExtractor={(item) => item.id}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode="on-drag"
                            style={styles.results}
                            ListEmptyComponent={
                                showFriendSuggestions ? (
                                    <Text style={styles.hint}>{t('invite.searchHint')}</Text>
                                ) : query.trim().length >= 2 && !searching ? (
                                    <Text style={styles.emptyResults}>{t('invite.noResults')}</Text>
                                ) : (
                                    <Text style={styles.hint}>{t('invite.searchHint')}</Text>
                                )
                            }
                            ListHeaderComponent={
                                showFriendSuggestions && suggestionList.length > 0 ? (
                                    <Text style={styles.sectionLabel}>{t('friends.tabFriends')}</Text>
                                ) : null
                            }
                            renderItem={({ item }) => (
                                <View style={styles.resultRow}>
                                    <TouchableOpacity
                                        style={styles.resultTap}
                                        onPress={() => openProfile(item.id)}
                                        activeOpacity={0.85}
                                    >
                                        <Image
                                            source={{ uri: item.avatar_url || avatarFallback(item.nombre) }}
                                            style={styles.resultAvatar}
                                        />
                                        <View style={styles.resultInfo}>
                                            <Text style={styles.resultName} numberOfLines={1}>
                                                {item.nombre}
                                            </Text>
                                            {item.nombre_usuario ? (
                                                <Text style={styles.resultUser}>@{item.nombre_usuario}</Text>
                                            ) : null}
                                        </View>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.inviteBtn}
                                        onPress={() => void handleAdd(item)}
                                    >
                                        <Text style={styles.inviteBtnText}>{t('invite.action')}</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        />
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    overlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.45)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '88%',
        paddingHorizontal: 18,
        paddingTop: 8,
        zIndex: 2,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#E2E8F0',
        alignSelf: 'center',
        marginBottom: 12,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    title: { flex: 1, fontSize: 18, fontWeight: '900', color: INK },
    closeBtn: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    feedback: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 10,
        borderWidth: 1,
    },
    feedbackOk: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
    feedbackErr: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
    feedbackText: { flex: 1, fontSize: 13, fontWeight: '700' },
    feedbackTextOk: { color: '#15803D' },
    feedbackTextErr: { color: '#B91C1C' },
    selectedBlock: { marginBottom: 10 },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: '#64748B', marginBottom: 8, letterSpacing: 0.3 },
    selectedList: { gap: 8, paddingBottom: 4 },
    selectedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#EFF6FF',
        borderRadius: 16,
        paddingVertical: 6,
        paddingHorizontal: 10,
        maxWidth: 220,
    },
    selectedChipTap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
    selectedAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#DBEAFE' },
    selectedTextCol: { flexShrink: 1, minWidth: 0 },
    selectedName: { fontSize: 12, fontWeight: '700', color: PRIMARY_DARK },
    selectedBy: { fontSize: 10, fontWeight: '600', color: '#64748B', marginTop: 1 },
    emptySelected: { fontSize: 13, color: '#94A3B8', fontWeight: '600', marginBottom: 12 },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 8,
    },
    searchInput: { flex: 1, fontSize: 15, color: INK, fontWeight: '600', padding: 0 },
    results: { flexGrow: 0, minHeight: 120, maxHeight: 280 },
    hint: { textAlign: 'center', color: '#94A3B8', fontWeight: '600', marginTop: 24, fontSize: 13 },
    emptyResults: { textAlign: 'center', color: '#94A3B8', fontWeight: '600', marginTop: 24, fontSize: 13 },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
        gap: 10,
    },
    resultTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
    resultAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E3ECFB' },
    resultInfo: { flex: 1, minWidth: 0 },
    resultName: { fontSize: 15, fontWeight: '800', color: INK },
    resultUser: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 2 },
    inviteBtn: {
        backgroundColor: PRIMARY_DARK,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        minWidth: 78,
        alignItems: 'center',
    },
    inviteBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
});
