import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { PlanImage } from './PlanImage';
import { ProfileAvatar } from './ProfileAvatar';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { hapticSelection } from '../lib/haptics';
import { prefetchChatRow, seedChatThreadPeek } from '../lib/prefetchChats';
import { stripPlanTitleSuffix } from '../lib/planDisplay';
import { resolvePlanImageSource } from '../lib/sports';
import { type ThemeColors } from '../theme';

export type ChatListItem = {
    id: string;
    title: string;
    image_url: string | null;
    kind: 'plan' | 'group' | 'direct';
    peerId?: string;
    creadorId?: string;
    fechaEvento?: string | null;
    ultimoTexto: string;
    lastAt: string;
    unread: number;
};

export function chatRowKey(item: ChatListItem) {
    return `${item.kind}:${item.id}`;
}

type Props = {
    item: ChatListItem;
    currentUserId: string | null;
    deleteLabel: string;
    onDelete: (item: ChatListItem) => void;
    onOpen: (item: ChatListItem) => void;
    onMarkRead: (item: ChatListItem) => void;
    onSwipeWillOpen: (key: string) => void;
    onSwipeClose: (key: string) => void;
    registerSwipeRef: (key: string, ref: Swipeable | null) => void;
};

function ChatListRowInner({
    item,
    currentUserId,
    deleteLabel,
    onDelete,
    onOpen,
    onMarkRead,
    onSwipeWillOpen,
    onSwipeClose,
    registerSwipeRef,
}: Props) {
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createChatListRowStyles);
    const key = chatRowKey(item);

    const handlePress = useCallback(() => {
        hapticSelection();
        onMarkRead(item);
        seedChatThreadPeek(currentUserId, {
            id: item.id,
            title: item.title,
            image_url: item.image_url,
            kind: item.kind,
            peerId: item.peerId,
            creadorId: item.creadorId,
            fechaEvento: item.fechaEvento,
            lastAt: item.lastAt,
            unread: item.unread,
        });
        onOpen(item);
    }, [currentUserId, item, onMarkRead, onOpen]);

    const handlePressIn = useCallback(() => {
        seedChatThreadPeek(currentUserId, {
            id: item.id,
            title: item.title,
            image_url: item.image_url,
            kind: item.kind,
            peerId: item.peerId,
            creadorId: item.creadorId,
            fechaEvento: item.fechaEvento,
            lastAt: item.lastAt,
            unread: item.unread,
        });
        prefetchChatRow(currentUserId, item);
    }, [currentUserId, item]);

    return (
        <View style={styles.swipeRow}>
            <Swipeable
                ref={(ref) => registerSwipeRef(key, ref)}
                overshootRight={false}
                overshootLeft={false}
                friction={2}
                rightThreshold={40}
                activeOffsetX={[-28, 1000]}
                failOffsetX={[-1000, 24]}
                failOffsetY={[-16, 16]}
                onSwipeableWillOpen={() => onSwipeWillOpen(key)}
                onSwipeableClose={() => onSwipeClose(key)}
                renderRightActions={() => (
                    <TouchableOpacity
                        style={styles.deleteAction}
                        activeOpacity={0.9}
                        onPress={() => onDelete(item)}
                    >
                        <Ionicons name="trash" size={22} color={colors.onPrimary} />
                        <Text style={styles.deleteActionText}>{deleteLabel}</Text>
                    </TouchableOpacity>
                )}
            >
                <TouchableOpacity
                    style={styles.chatCard}
                    activeOpacity={0.85}
                    onLongPress={() => onDelete(item)}
                    onPressIn={handlePressIn}
                    onPress={handlePress}
                >
                    {item.kind === 'direct' ? (
                        <ProfileAvatar
                            uri={item.image_url}
                            name={stripPlanTitleSuffix(item.title)}
                            size={56}
                            recyclingKey={item.peerId ?? item.id}
                            priority="normal"
                        />
                    ) : item.kind === 'group' && item.image_url ? (
                        <PlanImage
                            source={resolvePlanImageSource(item.image_url)}
                            style={styles.chatImage}
                            recyclingKey={`group-${item.id}`}
                            thumbWidth={160}
                        />
                    ) : item.kind === 'group' ? (
                        <View style={styles.groupIconWrap}>
                            <Ionicons name="people" size={28} color={colors.primary} />
                        </View>
                    ) : (
                        <PlanImage
                            source={resolvePlanImageSource(item.image_url)}
                            style={styles.chatImage}
                            recyclingKey={String(item.id)}
                            thumbWidth={160}
                        />
                    )}
                    <View style={styles.chatInfo}>
                        <Text style={styles.chatTitle} numberOfLines={1}>
                            {stripPlanTitleSuffix(item.title)}
                        </Text>
                        <Text style={styles.lastMsg} numberOfLines={1}>
                            {item.ultimoTexto}
                        </Text>
                    </View>
                    {item.unread > 0 ? (
                        <View style={styles.unreadBadge}>
                            <Text style={styles.unreadText}>
                                {item.unread > 9 ? '9+' : item.unread}
                            </Text>
                        </View>
                    ) : null}
                </TouchableOpacity>
            </Swipeable>
        </View>
    );
}

export const ChatListRow = memo(ChatListRowInner, (prev, next) => {
    return (
        prev.item.id === next.item.id
        && prev.item.kind === next.item.kind
        && prev.item.unread === next.item.unread
        && prev.item.ultimoTexto === next.item.ultimoTexto
        && prev.item.title === next.item.title
        && prev.item.image_url === next.item.image_url
        && prev.currentUserId === next.currentUserId
        && prev.deleteLabel === next.deleteLabel
        && prev.onDelete === next.onDelete
        && prev.onOpen === next.onOpen
        && prev.onMarkRead === next.onMarkRead
        && prev.onSwipeWillOpen === next.onSwipeWillOpen
        && prev.onSwipeClose === next.onSwipeClose
        && prev.registerSwipeRef === next.registerSwipeRef
    );
});

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

function createChatListRowStyles(c: ThemeColors) {
    return StyleSheet.create({
        swipeRow: { marginBottom: 0 },
        chatCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.surface,
            marginHorizontal: 16,
            marginBottom: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: c.border,
            shadowColor: '#0F172A',
            shadowOpacity: 0.06,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 2,
        },
        deleteAction: {
            width: 88,
            marginRight: 16,
            marginBottom: 10,
            borderRadius: 18,
            backgroundColor: c.danger,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 4,
        },
        deleteActionText: { color: c.onPrimary, fontWeight: '800', fontSize: 12 },
        chatImage: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.border },
        groupIconWrap: {
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: c.primarySoft,
            justifyContent: 'center',
            alignItems: 'center',
        },
        chatInfo: { flex: 1, marginLeft: 12, minWidth: 0 },
        chatTitle: { fontSize: 16, fontWeight: '800', color: INK, lineHeight: 20 },
        lastMsg: { fontSize: 13, color: c.textSubtle, lineHeight: 18, marginTop: 4 },
        unreadBadge: {
            minWidth: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: PRIMARY_DARK,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 6,
            marginLeft: 8,
        },
        unreadText: { color: c.onPrimary, fontSize: 11, fontWeight: '800' },
    });
}
