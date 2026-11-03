import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
    ActivityIndicator,
    FlatList,
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
import { seedUserProfilePeek, prefetchUserProfile } from '../lib/userProfileCache';
import { useT } from '../lib/i18n';
import { listBrowseDirectory, searchProfilesByName } from '../lib/profileFields';
import {
    inviteChatGroupToPlan,
    listGroupMemberIds,
    listGroupsInvitedToPlan,
    listMyChatGroups,
    type ChatGroupOption,
} from '../lib/inviteChatGroup';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';

const INVITE_FRIENDS_TTL_MS = 60_000;
const INVITE_OTHERS_TTL_MS = 45_000;
const INVITE_GROUPS_TTL_MS = 45_000;
const inviteFriendsKey = (userId: string) => `inviteFriends:${userId}`;
const inviteOthersKey = (userId: string) => `inviteOthers:rc3:${userId}`;
const inviteGroupsKey = (userId: string) => `inviteGroups:v1:${userId}`;

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
    /** Grupos ya invitados (o en cola al crear). Aparecen en Invitados y no se pueden volver a invitar. */
    selectedGroups?: ChatGroupOption[];
    excludeIds?: Set<string>;
    /** Plan al que se invita (si existe). Sin él, los grupos van a onAddGroup. */
    targetPlanId?: string | null;
    /** Debe resolver con `{ error }` — no abrir Alert (congela si hay Modal abierto). */
    onAdd: (profile: InviteProfile) => void | InviteAddResult | Promise<void | InviteAddResult>;
    onRemove?: (profileId: string) => void | { error: string | null } | Promise<void | { error: string | null }>;
    /** Crear plan: guardar grupo pendiente hasta publicar. */
    onAddGroup?: (group: ChatGroupOption) => void | InviteAddResult | Promise<void | InviteAddResult>;
    /** Tras invitar un grupo con éxito (plan ya publicado). */
    onGroupInvited?: (group: ChatGroupOption) => void;
    /** Quitar grupo de la cola (crear/editar plan). */
    onRemoveGroup?: (groupId: string) => void | { error: string | null } | Promise<void | { error: string | null }>;
    title?: string;
    /** Si se pasa, muestra el botón de compartir junto a la X. */
    onShare?: () => void;
};

type ListRow =
    | { kind: 'header'; id: string; title: string }
    | { kind: 'person'; id: string; person: InviteProfile }
    | { kind: 'group'; id: string; group: ChatGroupOption };

const avatarFallback = (name?: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'N')}&background=4DA6FF&color=fff`;

export function InvitePeopleSheet({
    visible,
    onClose,
    currentUserId,
    selected,
    selectedGroups = [],
    excludeIds,
    targetPlanId,
    onAdd,
    onRemove,
    onAddGroup,
    onGroupInvited,
    onRemoveGroup,
    title,
    onShare,
}: Props) {
    const { t } = useT();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<InviteProfile[]>([]);
    const [friendSuggestions, setFriendSuggestions] = useState<InviteProfile[]>([]);
    const [otherSuggestions, setOtherSuggestions] = useState<InviteProfile[]>([]);
    const [groupSuggestions, setGroupSuggestions] = useState<ChatGroupOption[]>([]);
    const [localInvitedGroups, setLocalInvitedGroups] = useState<ChatGroupOption[]>([]);
    const [groupMemberIds, setGroupMemberIds] = useState<Set<string>>(() => new Set());
    const [searching, setSearching] = useState(false);
    const [keyboardH, setKeyboardH] = useState(0);
    const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
    const [invitingGroupId, setInvitingGroupId] = useState<string | null>(null);
    const inFlightRef = useRef<Set<string>>(new Set());
    const rawResultsRef = useRef<InviteProfile[]>([]);
    const searchGenRef = useRef(0);

    const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
    const invitedGroups = useMemo(() => {
        const map = new Map<string, ChatGroupOption>();
        for (const g of selectedGroups) map.set(g.id, g);
        for (const g of localInvitedGroups) map.set(g.id, g);
        return [...map.values()];
    }, [selectedGroups, localInvitedGroups]);
    const invitedGroupIds = useMemo(() => new Set(invitedGroups.map((g) => g.id)), [invitedGroups]);
    /** A los miembros de un grupo invitado los representa el chip del grupo, no uno a uno. */
    const selectedSolo = useMemo(
        () => selected.filter((p) => !groupMemberIds.has(p.id)),
        [selected, groupMemberIds],
    );
    /** Solo miembros del plan (no invitados): los invitados siguen en la lista con botón Invitado/a. */
    const memberExcludeIds = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
    const memberExcludeIdsRef = useRef(memberExcludeIds);
    memberExcludeIdsRef.current = memberExcludeIds;

    const filterOutMembers = useCallback((list: InviteProfile[]) => {
        const excluded = memberExcludeIdsRef.current;
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
            setLocalInvitedGroups([]);
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

    // Resto de usuarios de la app (después de amigos).
    useEffect(() => {
        if (!visible || !currentUserId) {
            setOtherSuggestions([]);
            return;
        }
        let cancelled = false;
        const cached = cacheGetStale<InviteProfile[]>(inviteOthersKey(currentUserId));
        if (cached?.length) setOtherSuggestions(cached);
        void listBrowseDirectory({
            userId: currentUserId,
            excludeUserId: currentUserId,
            limit: 60,
        })
            .then((rows) => {
                if (cancelled) return;
                const mapped = rows.map((p) => ({
                    id: p.id,
                    nombre: p.nombre || t('profile.user'),
                    nombre_usuario: p.nombre_usuario,
                    avatar_url: p.avatar_url,
                }));
                setOtherSuggestions(mapped);
                cacheSet(inviteOthersKey(currentUserId), mapped, INVITE_OTHERS_TTL_MS);
            })
            .catch(() => {
                if (!cancelled && !cached?.length) setOtherSuggestions([]);
            });
        return () => {
            cancelled = true;
        };
    }, [visible, currentUserId, t]);

    // Grupos de chat del usuario; rehidrata los ya invitados a este plan.
    useEffect(() => {
        if (!visible || !currentUserId) {
            setGroupSuggestions([]);
            return;
        }
        let cancelled = false;
        const cached = cacheGetStale<ChatGroupOption[]>(inviteGroupsKey(currentUserId));
        if (cached?.length) {
            const selectedBlock = new Set(selectedGroups.map((g) => g.id));
            setGroupSuggestions(
                cached.filter((g) => g.id !== targetPlanId && !selectedBlock.has(g.id)),
            );
        }
        void (async () => {
            try {
                const rows = await listMyChatGroups(currentUserId);
                if (cancelled) return;
                cacheSet(inviteGroupsKey(currentUserId), rows, INVITE_GROUPS_TTL_MS);

                let blocked = new Set<string>([
                    ...(targetPlanId ? [targetPlanId] : []),
                    ...selectedGroups.map((g) => g.id),
                ]);

                if (targetPlanId && rows.length) {
                    const already = await listGroupsInvitedToPlan(
                        targetPlanId,
                        rows.map((g) => g.id),
                    );
                    if (!cancelled && already.length) {
                        setLocalInvitedGroups((prev) => {
                            const map = new Map(prev.map((g) => [g.id, g]));
                            for (const g of already) {
                                const full = rows.find((r) => r.id === g.id) ?? g;
                                map.set(g.id, full);
                                blocked.add(g.id);
                            }
                            return [...map.values()];
                        });
                        for (const g of already) blocked.add(g.id);
                    }
                }
                if (cancelled) return;
                setGroupSuggestions(rows.filter((g) => !blocked.has(g.id)));
            } catch {
                if (!cancelled && !cached?.length) setGroupSuggestions([]);
            }
        })();
        return () => {
            cancelled = true;
        };
        // selectedGroups se lee al abrir; cambios posteriores se filtran abajo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, currentUserId, targetPlanId]);

    // Mantener sugerencias de grupos sin los ya invitados (sin re-fetch).
    useEffect(() => {
        if (!visible) return;
        setGroupSuggestions((prev) => prev.filter((g) => !invitedGroupIds.has(g.id)));
    }, [visible, invitedGroupIds]);

    // Al invitar a un grupo sus miembros ya tienen la invitación: salen como Invitado/a.
    useEffect(() => {
        if (!visible || invitedGroupIds.size === 0) {
            setGroupMemberIds(new Set());
            return;
        }
        let cancelled = false;
        void listGroupMemberIds([...invitedGroupIds], { targetPlanId })
            .then((ids) => {
                if (cancelled) return;
                setGroupMemberIds(new Set(ids));
            })
            .catch(() => {
                if (!cancelled) setGroupMemberIds(new Set());
            });
        return () => {
            cancelled = true;
        };
    }, [visible, invitedGroupIds, targetPlanId]);

    // Al invitar/quitar alguien, filtrar en cliente sin volver a pedir a la red.
    useEffect(() => {
        if (!visible) return;
        if (query.trim().length >= 2) {
            setResults(filterOutMembers(rawResultsRef.current));
        }
    }, [visible, query, filterOutMembers, memberExcludeIds]);

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
                    const data = await searchProfilesByName(q, currentUserId ?? undefined);
                    if (gen !== searchGenRef.current) return;
                    const mapped = data.map((p) => ({
                        id: p.id,
                        nombre: p.nombre || t('profile.user'),
                        nombre_usuario: p.nombre_usuario,
                        avatar_url: p.avatar_url,
                    }));
                    rawResultsRef.current = mapped;
                    setResults(filterOutMembers(mapped));
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
        // No depende de invitados: eso se marca en el botón Invitado/a.
    }, [query, visible, currentUserId, t, filterOutMembers]);

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
                if (error === 'organizer_cannot_join') {
                    setResults((prev) => (prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev]));
                    setFeedback({ ok: false, text: t('organizer.cannotInvite') });
                    return;
                }
                if (error === 'gender_restricted') {
                    setResults((prev) => (prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev]));
                    setFeedback({ ok: false, text: t('invite.genderBlocked') });
                    return;
                }
                if (error === 'blocked') {
                    setResults((prev) => (prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev]));
                    setFeedback({ ok: false, text: t('invite.blockedUser') });
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
            const person =
                results.find((r) => r.id === profileId) ||
                friendSuggestions.find((r) => r.id === profileId) ||
                otherSuggestions.find((r) => r.id === profileId) ||
                null;
            seedUserProfilePeek({
                id: profileId,
                nombre: person?.nombre,
                nombre_usuario: person?.nombre_usuario,
                avatar_url: person?.avatar_url,
            });
            prefetchUserProfile(profileId);
            onClose();
            requestAnimationFrame(() => {
                router.push(`/user-profile/${profileId}`);
            });
        },
        [onClose, router, results, friendSuggestions, otherSuggestions],
    );

    const bottomPad = Math.max(insets.bottom, 16) + (Platform.OS === 'android' ? keyboardH : 0);
    const showBrowse = query.trim().length < 2;

    const listData = useMemo((): ListRow[] => {
        if (!showBrowse) {
            return results.map((person) => ({ kind: 'person' as const, id: person.id, person }));
        }
        const friends = filterOutMembers(friendSuggestions);
        const friendIdSet = new Set(friends.map((f) => f.id));
        const others = filterOutMembers(otherSuggestions).filter((p) => !friendIdSet.has(p.id));
        const rows: ListRow[] = [];
        if (groupSuggestions.length > 0 && (targetPlanId || onAddGroup)) {
            const availableGroups = groupSuggestions.filter((g) => !invitedGroupIds.has(g.id));
            if (availableGroups.length > 0) {
                rows.push({ kind: 'header', id: 'hdr-groups', title: t('invite.sectionGroups') });
                for (const group of availableGroups) {
                    rows.push({ kind: 'group', id: `g-${group.id}`, group });
                }
            }
        }
        if (friends.length > 0) {
            rows.push({ kind: 'header', id: 'hdr-friends', title: t('invite.sectionFriends') });
            for (const person of friends) {
                rows.push({ kind: 'person', id: `f-${person.id}`, person });
            }
        }
        if (others.length > 0) {
            rows.push({ kind: 'header', id: 'hdr-others', title: t('invite.sectionOthers') });
            for (const person of others) {
                rows.push({ kind: 'person', id: `o-${person.id}`, person });
            }
        }
        return rows;
    }, [
        showBrowse,
        results,
        friendSuggestions,
        otherSuggestions,
        groupSuggestions,
        invitedGroupIds,
        filterOutMembers,
        t,
        targetPlanId,
        onAddGroup,
    ]);

    const handleInviteGroup = useCallback(
        async (group: ChatGroupOption) => {
            if (invitedGroupIds.has(group.id)) return;
            if (invitingGroupId || inFlightRef.current.has(group.id)) return;
            inFlightRef.current.add(group.id);
            setInvitingGroupId(group.id);
            setFeedback(null);
            hapticSelection();
            try {
                if (targetPlanId && currentUserId) {
                    const res = await inviteChatGroupToPlan({
                        groupChatId: group.id,
                        targetPlanId,
                        invitadorId: currentUserId,
                    });
                    if (res.error && res.invited === 0) {
                        setFeedback({
                            ok: false,
                            text:
                                res.error === 'gender_restricted'
                                    ? t('invite.groupGenderBlockedAll')
                                    : t('invite.groupInviteError'),
                        });
                        return;
                    }
                    hapticSuccess();
                    setFeedback(
                        res.invited > 0
                            ? {
                                  ok: true,
                                  text:
                                      res.skippedGender > 0
                                          ? t('invite.groupInviteOkGender', {
                                                n: res.invited,
                                                name: group.title,
                                                blocked: res.skippedGender,
                                            })
                                          : t('invite.groupInviteOk', {
                                                n: res.invited,
                                                name: group.title,
                                            }),
                              }
                            : { ok: false, text: t('friends.inviteAlready') },
                    );
                    setLocalInvitedGroups((prev) =>
                        prev.some((g) => g.id === group.id) ? prev : [...prev, group],
                    );
                    setGroupSuggestions((prev) => prev.filter((g) => g.id !== group.id));
                    onGroupInvited?.(group);
                    return;
                }
                if (onAddGroup) {
                    const result = await onAddGroup(group);
                    const error = result && typeof result === 'object' ? result.error : null;
                    if (error) {
                        setFeedback({ ok: false, text: t('invite.groupInviteError') });
                        return;
                    }
                    hapticSuccess();
                    setFeedback({ ok: true, text: t('invite.groupQueued', { name: group.title }) });
                    setGroupSuggestions((prev) => prev.filter((g) => g.id !== group.id));
                }
            } catch {
                setFeedback({ ok: false, text: t('invite.groupInviteError') });
            } finally {
                inFlightRef.current.delete(group.id);
                setInvitingGroupId(null);
            }
        },
        [invitingGroupId, invitedGroupIds, targetPlanId, currentUserId, onAddGroup, onGroupInvited, t],
    );

    const handleRemoveGroup = useCallback(
        async (group: ChatGroupOption) => {
            if (!onRemoveGroup || inFlightRef.current.has(group.id)) return;
            inFlightRef.current.add(group.id);
            hapticLight();
            setFeedback(null);
            try {
                const result = await onRemoveGroup(group.id);
                const error = result && typeof result === 'object' ? result.error : null;
                if (error) {
                    setFeedback({ ok: false, text: t('invite.removeError') });
                    return;
                }
                setLocalInvitedGroups((prev) => prev.filter((g) => g.id !== group.id));
                setGroupSuggestions((prev) =>
                    prev.some((g) => g.id === group.id) ? prev : [group, ...prev],
                );
                setFeedback({ ok: true, text: t('invite.removedOk') });
            } catch {
                setFeedback({ ok: false, text: t('invite.removeError') });
            } finally {
                inFlightRef.current.delete(group.id);
            }
        },
        [onRemoveGroup, t],
    );

    const handleSharePress = useCallback(() => {
        if (!onShare) return;
        hapticSelection();
        onShare();
    }, [onShare]);

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
            >
                <View style={styles.overlay}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                    <View
                        style={[
                            styles.sheet,
                            { paddingBottom: bottomPad, maxHeight: keyboardH > 0 ? '96%' : '94%' },
                        ]}
                    >
                        <View style={styles.handle} />
                        <View style={styles.headerRow}>
                            <Text style={styles.title}>{title || t('invite.sheetTitle')}</Text>
                            <View style={styles.headerActions}>
                                {onShare ? (
                                    <TouchableOpacity
                                        onPress={handleSharePress}
                                        hitSlop={10}
                                        style={styles.headerBtn}
                                        accessibilityLabel={t('card.share')}
                                    >
                                        <Ionicons name="share-outline" size={20} color={INK} />
                                    </TouchableOpacity>
                                ) : null}
                                <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.headerBtn}>
                                    <Ionicons name="close" size={22} color={INK} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {feedback ? (
                            <View style={[styles.feedback, feedback.ok ? styles.feedbackOk : styles.feedbackErr]}>
                                <Ionicons
                                    name={feedback.ok ? 'checkmark-circle' : 'alert-circle'}
                                    size={16}
                                    color={feedback.ok ? '#15803D' : '#B91C1C'}
                                />
                                <Text
                                    style={[
                                        styles.feedbackText,
                                        feedback.ok ? styles.feedbackTextOk : styles.feedbackTextErr,
                                    ]}
                                >
                                    {feedback.text}
                                </Text>
                            </View>
                        ) : null}

                        {selectedSolo.length > 0 || invitedGroups.length > 0 ? (
                            <View style={styles.selectedBlock}>
                                <Text style={styles.sectionLabel}>{t('invite.invitedList')}</Text>
                                <FlatList
                                    horizontal
                                    data={[
                                        ...invitedGroups.map((g) => ({ kind: 'group' as const, group: g })),
                                        ...selectedSolo.map((p) => ({ kind: 'person' as const, person: p })),
                                    ]}
                                    keyExtractor={(item) =>
                                        item.kind === 'group' ? `sg-${item.group.id}` : item.person.id
                                    }
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.selectedList}
                                    keyboardShouldPersistTaps="handled"
                                    renderItem={({ item }) => {
                                        if (item.kind === 'group') {
                                            const group = item.group;
                                            return (
                                                <View style={styles.selectedChip}>
                                                    <View style={styles.selectedChipTap}>
                                                        {group.image_url ? (
                                                            <Image
                                                                source={{ uri: group.image_url }}
                                                                style={styles.selectedAvatar}
                                                                contentFit="cover"
                                                                cachePolicy="memory-disk"
                                                                recyclingKey={group.id}
                                                                transition={0}
                                                            />
                                                        ) : (
                                                            <View
                                                                style={[
                                                                    styles.selectedAvatar,
                                                                    styles.groupAvatarFallback,
                                                                ]}
                                                            >
                                                                <Ionicons
                                                                    name="people"
                                                                    size={14}
                                                                    color={PRIMARY_DARK}
                                                                />
                                                            </View>
                                                        )}
                                                        <View style={styles.selectedTextCol}>
                                                            <Text style={styles.selectedName} numberOfLines={1}>
                                                                {group.title}
                                                            </Text>
                                                            <Text style={styles.selectedBy} numberOfLines={1}>
                                                                {t('invite.sectionGroups')}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                    {onRemoveGroup ? (
                                                        <TouchableOpacity
                                                            onPress={() => void handleRemoveGroup(group)}
                                                            hitSlop={8}
                                                        >
                                                            <Ionicons
                                                                name="close-circle"
                                                                size={18}
                                                                color="#94A3B8"
                                                            />
                                                        </TouchableOpacity>
                                                    ) : null}
                                                </View>
                                            );
                                        }
                                        const person = item.person;
                                        return (
                                        <View style={styles.selectedChip}>
                                            <TouchableOpacity
                                                style={styles.selectedChipTap}
                                                onPress={() => openProfile(person.id)}
                                                activeOpacity={0.85}
                                            >
                                                <Image
                                                    source={{
                                                        uri: person.avatar_url || avatarFallback(person.nombre),
                                                    }}
                                                    style={styles.selectedAvatar}
                                                    contentFit="cover"
                                                    cachePolicy="memory-disk"
                                                    recyclingKey={person.id}
                                                    transition={0}
                                                />
                                                <View style={styles.selectedTextCol}>
                                                    <Text style={styles.selectedName} numberOfLines={1}>
                                                        {person.nombre}
                                                    </Text>
                                                    {person.invitedByName ? (
                                                        <Text style={styles.selectedBy} numberOfLines={1}>
                                                            {t('invite.invitedBy', {
                                                                name: person.invitedByName,
                                                            })}
                                                        </Text>
                                                    ) : null}
                                                </View>
                                            </TouchableOpacity>
                                            {onRemove ? (
                                                <TouchableOpacity
                                                    onPress={() => void handleRemove(person.id)}
                                                    hitSlop={8}
                                                >
                                                    <Ionicons name="close-circle" size={18} color="#94A3B8" />
                                                </TouchableOpacity>
                                            ) : null}
                                        </View>
                                        );
                                    }}
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
                                showBrowse ? (
                                    <Text style={styles.hint}>{t('invite.searchHint')}</Text>
                                ) : query.trim().length >= 2 && !searching ? (
                                    <Text style={styles.emptyResults}>{t('invite.noResults')}</Text>
                                ) : (
                                    <Text style={styles.hint}>{t('invite.searchHint')}</Text>
                                )
                            }
                            renderItem={({ item }) => {
                                if (item.kind === 'header') {
                                    return <Text style={styles.listSectionLabel}>{item.title}</Text>;
                                }
                                if (item.kind === 'group') {
                                    const group = item.group;
                                    const busy = invitingGroupId === group.id;
                                    return (
                                        <View style={styles.resultRow}>
                                            <View style={styles.resultTap}>
                                                {group.image_url ? (
                                                    <Image
                                                        source={{ uri: group.image_url }}
                                                        style={styles.resultAvatar}
                                                        contentFit="cover"
                                                        cachePolicy="memory-disk"
                                                        recyclingKey={group.id}
                                                        transition={0}
                                                    />
                                                ) : (
                                                    <View style={[styles.resultAvatar, styles.groupAvatarFallback]}>
                                                        <Ionicons name="people" size={20} color={PRIMARY_DARK} />
                                                    </View>
                                                )}
                                                <View style={styles.resultInfo}>
                                                    <Text style={styles.resultName} numberOfLines={1}>
                                                        {group.title}
                                                    </Text>
                                                    <Text style={styles.groupMeta} numberOfLines={1}>
                                                        {t('invite.groupMembers', { n: group.memberCount })}
                                                    </Text>
                                                </View>
                                            </View>
                                            <TouchableOpacity
                                                style={[styles.inviteBtn, busy && { opacity: 0.6 }]}
                                                onPress={() => void handleInviteGroup(group)}
                                                disabled={busy}
                                            >
                                                {busy ? (
                                                    <ActivityIndicator color="#FFF" size="small" />
                                                ) : (
                                                    <Text style={styles.inviteBtnText}>{t('invite.action')}</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    );
                                }
                                const person = item.person;
                                const alreadyInvited =
                                    selectedIds.has(person.id) || groupMemberIds.has(person.id);
                                return (
                                    <View style={styles.resultRow}>
                                        <TouchableOpacity
                                            style={styles.resultTap}
                                            onPress={() => openProfile(person.id)}
                                            activeOpacity={0.85}
                                        >
                                            <Image
                                                source={{
                                                    uri: person.avatar_url || avatarFallback(person.nombre),
                                                }}
                                                style={styles.resultAvatar}
                                                contentFit="cover"
                                                cachePolicy="memory-disk"
                                                recyclingKey={person.id}
                                                transition={0}
                                            />
                                            <View style={styles.resultInfo}>
                                                <Text style={styles.resultName} numberOfLines={1}>
                                                    {person.nombre}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                        {alreadyInvited ? (
                                            <View style={[styles.inviteBtn, styles.inviteBtnDone]}>
                                                <Text style={styles.inviteBtnDoneText}>
                                                    {t('invite.alreadyInvitedBtn')}
                                                </Text>
                                            </View>
                                        ) : (
                                            <TouchableOpacity
                                                style={styles.inviteBtn}
                                                onPress={() => void handleAdd(person)}
                                            >
                                                <Text style={styles.inviteBtnText}>{t('invite.action')}</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                );
                            }}
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
        maxHeight: '94%',
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
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
    title: { flex: 1, fontSize: 18, fontWeight: '900', color: INK },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerBtn: {
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
    listSectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#64748B',
        marginTop: 10,
        marginBottom: 6,
        letterSpacing: 0.3,
    },
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
    results: { flexGrow: 0, minHeight: 160, maxHeight: 420 },
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
    groupAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DBEAFE' },
    groupMeta: { fontSize: 12, fontWeight: '600', color: '#94A3B8', marginTop: 2 },
    resultInfo: { flex: 1, minWidth: 0 },
    resultName: { fontSize: 15, fontWeight: '800', color: INK },
    resultUser: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 2 },
    inviteBtn: {
        backgroundColor: PRIMARY_DARK,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
    },
    inviteBtnDone: {
        backgroundColor: '#E2E8F0',
    },
    inviteBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
    inviteBtnDoneText: { color: '#64748B', fontWeight: '800', fontSize: 13 },
});
