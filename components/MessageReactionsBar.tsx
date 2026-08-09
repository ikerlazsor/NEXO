import { useEffect, useMemo, useState } from 'react';
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    REACTION_EMOJIS,
    fetchReactionsForMessages,
    summarizeReactions,
    toggleReaction,
    type MessageReaction,
} from '../lib/messageReactions';
import { hapticSelection } from '../lib/haptics';

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
    const summary = useMemo(
        () => summarizeReactions(reactions, messageId, userId),
        [reactions, messageId, userId],
    );
    if (!summary.length) return null;
    return (
        <View style={[styles.chipRow, alignRight && styles.chipRowRight]}>
            {summary.map((s) => (
                <TouchableOpacity
                    key={s.emoji}
                    style={[styles.chip, s.reactedByMe && styles.chipMine]}
                    onPress={() => {
                        hapticSelection();
                        onPick(s.emoji);
                    }}
                    activeOpacity={0.85}
                >
                    <Text style={styles.chipEmoji}>{s.emoji}</Text>
                    <Text style={styles.chipCount}>{s.count}</Text>
                </TouchableOpacity>
            ))}
        </View>
    );
}

type PickerProps = {
    visible: boolean;
    onClose: () => void;
    onPick: (emoji: string) => void;
};

export function ReactionEmojiPicker({ visible, onClose, onPick }: PickerProps) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <View style={styles.picker}>
                    {REACTION_EMOJIS.map((emoji) => (
                        <TouchableOpacity
                            key={emoji}
                            style={styles.pickerBtn}
                            onPress={() => {
                                hapticSelection();
                                onPick(emoji);
                            }}
                            activeOpacity={0.85}
                        >
                            <Text style={styles.pickerEmoji}>{emoji}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </Pressable>
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
    const key = messageIds.slice().sort().join(',');

    useEffect(() => {
        let alive = true;
        if (!messageIds.length) {
            setReactions([]);
            return;
        }
        void fetchReactionsForMessages(messageIds).then((rows) => {
            if (alive) setReactions(rows);
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
        marginTop: 4,
        maxWidth: 260,
    },
    chipRowRight: { alignSelf: 'flex-end' },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    chipMine: { backgroundColor: '#DBEAFE', borderColor: '#93C5FD' },
    chipEmoji: { fontSize: 13 },
    chipCount: { fontSize: 11, fontWeight: '700', color: '#475569' },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(15,42,74,0.35)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    picker: {
        flexDirection: 'row',
        backgroundColor: '#FFF',
        borderRadius: 28,
        paddingHorizontal: 10,
        paddingVertical: 10,
        gap: 4,
        shadowColor: '#0F172A',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
    },
    pickerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
    pickerEmoji: { fontSize: 28 },
});
