import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { ProfileAvatar } from './ProfileAvatar';
import {
    REACTION_EMOJIS,
    fetchReactionsForMessages,
    summarizeReactions,
    toggleReaction,
    type MessageReaction,
} from '../lib/messageReactions';
import { EMOJI_CATEGORIES } from '../lib/reactionEmojiCatalog';
import { getPublicProfileCards, peekPublicProfileCards } from '../lib/profileData';
import { hapticSelection } from '../lib/haptics';
import { useT } from '../lib/i18n';

type ChipsProps = {
    messageId: string;
    userId: string | null;
    reactions: MessageReaction[];
    onPick: (emoji: string) => void;
    alignRight?: boolean;
};

export function MessageReactionChips({
    messageId,
    userId,
    reactions,
    onPick,
    alignRight,
}: ChipsProps) {
    const [whoOpen, setWhoOpen] = useState(false);
    const summary = useMemo(
        () => summarizeReactions(reactions, messageId, userId),
        [reactions, messageId, userId],
    );
    const mine = useMemo(
        () => reactions.filter((r) => r.mensaje_id === messageId),
        [reactions, messageId],
    );
    if (!summary.length) return null;
    return (
        <>
            <View style={[styles.chipRow, alignRight && styles.chipRowRight]}>
                {summary.map((s) => (
                    <TouchableOpacity
                        key={s.emoji}
                        style={[styles.chip, s.reactedByMe && styles.chipMine]}
                        onPress={() => {
                            hapticSelection();
                            // Tu reacción: tocarla la quita. El resto: ver quién.
                            if (s.reactedByMe && userId) {
                                onPick(s.emoji);
                                return;
                            }
                            setWhoOpen(true);
                        }}
                        onLongPress={() => {
                            hapticSelection();
                            setWhoOpen(true);
                        }}
                        delayLongPress={280}
                        activeOpacity={0.85}
                    >
                        <Text style={styles.chipEmoji}>{s.emoji}</Text>
                        {s.count > 1 ? <Text style={styles.chipCount}>{s.count}</Text> : null}
                    </TouchableOpacity>
                ))}
            </View>
            <ReactionPeopleSheet
                visible={whoOpen}
                reactions={mine}
                userId={userId}
                onClose={() => setWhoOpen(false)}
            />
        </>
    );
}

function ReactionPeopleSheet({
    visible,
    reactions,
    userId,
    onClose,
}: {
    visible: boolean;
    reactions: MessageReaction[];
    userId: string | null;
    onClose: () => void;
}) {
    const { t } = useT();
    const idsKey = useMemo(
        () => [...new Set(reactions.map((r) => r.usuario_id))].sort().join(','),
        [reactions],
    );
    const [names, setNames] = useState<Map<string, { nombre: string | null; nombre_usuario: string | null; avatar_url: string | null }>>(
        () => new Map(),
    );

    useEffect(() => {
        if (!visible || !idsKey) return;
        const ids = idsKey.split(',').filter(Boolean);
        const peeked = peekPublicProfileCards(ids);
        if (peeked.length) {
            setNames(new Map(peeked.map((p) => [p.id, p])));
        }
        let alive = true;
        void getPublicProfileCards(ids).then((rows) => {
            if (!alive) return;
            setNames(new Map(rows.map((p) => [p.id, p])));
        }).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [visible, idsKey]);

    const rows = useMemo(() => {
        return [...reactions].sort((a, b) => {
            if (a.usuario_id === userId) return -1;
            if (b.usuario_id === userId) return 1;
            return a.emoji.localeCompare(b.emoji);
        });
    }, [reactions, userId]);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={styles.peopleCard}>
                    <Text style={styles.peopleTitle}>{t('chat.reactionsWho')}</Text>
                    <ScrollView style={styles.peopleList} bounces={false}>
                        {rows.map((r) => {
                            const profile = names.get(r.usuario_id);
                            const isMe = !!userId && r.usuario_id === userId;
                            const name = isMe
                                ? t('chat.reactionsYou')
                                : profile?.nombre?.trim() || profile?.nombre_usuario?.trim() || '…';
                            return (
                                <View key={`${r.usuario_id}:${r.emoji}`} style={styles.peopleRow}>
                                    <ProfileAvatar uri={profile?.avatar_url} name={name} size={36} />
                                    <Text style={styles.peopleName} numberOfLines={1}>{name}</Text>
                                    <Text style={styles.peopleEmoji}>{r.emoji}</Text>
                                </View>
                            );
                        })}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

type PickerProps = {
    visible: boolean;
    onClose: () => void;
    onPick: (emoji: string) => void;
    onReport?: () => void;
    reportLabel?: string;
    onDelete?: () => void;
    deleteLabel?: string;
};

export function ReactionEmojiPicker({
    visible,
    onClose,
    onPick,
    onReport,
    reportLabel = 'Reportar mensaje',
    onDelete,
    deleteLabel = 'Eliminar',
}: PickerProps) {
    const { t } = useT();
    const [expanded, setExpanded] = useState(false);
    const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0].id);
    const category = EMOJI_CATEGORIES.find((c) => c.id === categoryId) ?? EMOJI_CATEGORIES[0];

    useEffect(() => {
        if (!visible) {
            setExpanded(false);
            setCategoryId(EMOJI_CATEGORIES[0].id);
        }
    }, [visible]);

    const pick = (emoji: string) => {
        hapticSelection();
        onPick(emoji);
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={styles.picker}>
                    <View style={styles.quickRow}>
                        {REACTION_EMOJIS.map((emoji) => (
                            <TouchableOpacity
                                key={emoji}
                                style={styles.pickerBtn}
                                onPress={() => pick(emoji)}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.pickerEmoji}>{emoji}</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            style={[styles.plusBtn, expanded && styles.plusBtnOn]}
                            onPress={() => {
                                hapticSelection();
                                setExpanded((open) => !open);
                            }}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={t('chat.moreEmojis')}
                        >
                            <Ionicons name={expanded ? 'close' : 'add'} size={22} color="#0F2A4A" />
                        </TouchableOpacity>
                    </View>
                    {expanded ? (
                        <View style={styles.catalog}>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.categoryRow}
                            >
                                {EMOJI_CATEGORIES.map((c) => (
                                    <TouchableOpacity
                                        key={c.id}
                                        style={[styles.categoryBtn, c.id === category.id && styles.categoryBtnOn]}
                                        onPress={() => setCategoryId(c.id)}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.categoryIcon}>{c.icon}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                            <FlatList
                                data={category.emojis}
                                keyExtractor={(item) => item}
                                numColumns={7}
                                style={styles.emojiGrid}
                                keyboardShouldPersistTaps="handled"
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.gridBtn}
                                        onPress={() => pick(item)}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.gridEmoji}>{item}</Text>
                                    </TouchableOpacity>
                                )}
                            />
                        </View>
                    ) : null}
                    {onDelete ? (
                        <TouchableOpacity
                            style={styles.deleteBtn}
                            onPress={onDelete}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                        >
                            <Text style={styles.deleteText}>{deleteLabel}</Text>
                        </TouchableOpacity>
                    ) : null}
                    {onReport ? (
                        <TouchableOpacity
                            style={styles.reportBtn}
                            onPress={onReport}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                        >
                            <Text style={styles.reportText}>{reportLabel}</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

export async function applyMessageReaction(opts: {
    messageId: string;
    userId: string;
    emoji: string;
    reactions: MessageReaction[];
    setReactions: (rows: MessageReaction[]) => void;
}): Promise<void> {
    const { messageId, userId, emoji, reactions, setReactions } = opts;
    if (messageId.startsWith('local-')) return;
    const mine = reactions.find((r) => r.mensaje_id === messageId && r.usuario_id === userId);
    let next = reactions.filter((r) => !(r.mensaje_id === messageId && r.usuario_id === userId));
    if (!mine || mine.emoji !== emoji) {
        next = [...next, { mensaje_id: messageId, usuario_id: userId, emoji }];
    }
    setReactions(next);
    try {
        await toggleReaction({ messageId, userId, emoji });
        const relatedIds = [...new Set(next.map((r) => r.mensaje_id).concat(messageId))];
        const fresh = await fetchReactionsForMessages(relatedIds);
        const keep = next.filter((r) => !relatedIds.includes(r.mensaje_id));
        setReactions([...keep, ...fresh]);
    } catch {
        setReactions(reactions);
    }
}

export function useMessageReactions(messageIds: string[]) {
    const [reactions, setReactions] = useState<MessageReaction[]>([]);
    const loadedIdsRef = useRef<Set<string>>(new Set());
    const key = messageIds.slice().sort().join(',');

    useEffect(() => {
        let alive = true;
        if (!messageIds.length) {
            loadedIdsRef.current = new Set();
            setReactions([]);
            return;
        }
        const current = new Set(messageIds);
        for (const id of [...loadedIdsRef.current]) {
            if (!current.has(id)) loadedIdsRef.current.delete(id);
        }
        const missing = messageIds.filter((id) => !loadedIdsRef.current.has(id) && !id.startsWith('local-'));
        if (!missing.length) {
            setReactions((prev) => {
                const next = prev.filter((r) => current.has(r.mensaje_id));
                return next.length === prev.length ? prev : next;
            });
            return;
        }
        void fetchReactionsForMessages(missing).then((rows) => {
            if (!alive) return;
            for (const id of missing) loadedIdsRef.current.add(id);
            setReactions((prev) => {
                const keep = prev.filter((r) => current.has(r.mensaje_id) && !missing.includes(r.mensaje_id));
                return [...keep, ...rows];
            });
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return { reactions, setReactions };
}

const styles = StyleSheet.create({
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: -2,
        maxWidth: 260,
    },
    chipRowRight: { alignSelf: 'flex-end' },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#FFFFFF',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#F8FAFC',
        // Pastilla blanca redonda bajo la burbuja (sombra suave clara).
        shadowColor: '#E2E8F0',
        shadowOpacity: 1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    chipMine: {
        backgroundColor: '#FFFFFF',
        borderColor: '#BFDBFE',
    },
    chipEmoji: { fontSize: 13 },
    chipCount: { fontSize: 11, fontWeight: '700', color: '#475569' },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(15,42,74,0.28)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    picker: {
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 40,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 4,
        maxWidth: 360,
        width: '100%',
        shadowColor: '#F8FAFC',
        shadowOpacity: 1,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 6 },
        elevation: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#FFFFFF',
    },
    quickRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
    },
    pickerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
    plusBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
    },
    plusBtnOn: { backgroundColor: '#DBEAFE' },
    catalog: { width: 320, maxWidth: '100%', marginTop: 4 },
    categoryRow: { gap: 2, paddingVertical: 4, alignItems: 'center' },
    categoryBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
    categoryBtnOn: { backgroundColor: '#EFF6FF' },
    categoryIcon: { fontSize: 20 },
    emojiGrid: { height: 248 },
    gridBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    gridEmoji: { fontSize: 26 },
    peopleCard: {
        width: '100%',
        maxWidth: 340,
        backgroundColor: '#FFF',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
        shadowColor: '#0F172A',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
    },
    peopleTitle: { fontSize: 16, fontWeight: '800', color: '#0F2A4A', marginBottom: 8 },
    peopleList: { maxHeight: 340 },
    peopleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    peopleName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F2A4A' },
    peopleEmoji: { fontSize: 22 },
    reportBtn: {
        width: '100%',
        marginTop: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#E2E8F0',
        paddingTop: 10,
        paddingBottom: 4,
        alignItems: 'center',
    },
    reportText: { color: '#DC2626', fontWeight: '800', fontSize: 14 },
    deleteBtn: {
        width: '100%',
        marginTop: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#E2E8F0',
        paddingTop: 10,
        paddingBottom: 4,
        alignItems: 'center',
    },
    deleteText: { color: '#DC2626', fontWeight: '800', fontSize: 14 },
    pickerEmoji: { fontSize: 28 },
});
