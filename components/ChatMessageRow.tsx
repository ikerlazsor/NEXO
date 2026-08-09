import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { MessageReactionChips } from './MessageReactionsBar';
import { ProfileAvatar } from './ProfileAvatar';
import { hapticMedium, hapticSelection } from '../lib/haptics';
import { parseReplyContent } from '../lib/chatReply';
import type { MessageReaction } from '../lib/messageReactions';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const FRIEND = '#10B981';
const ACQUAINTANCE = '#7C3AED';
const REPLY_THRESHOLD = 44;
const MAX_DRAG = 64;

export type ChatMessage = {
    id: string;
    contenido: string;
    emisor_id: string;
    creado_en: string;
    tipo: 'texto' | 'imagen' | 'video' | 'audio';
    archivo_url: string | null;
    perfiles: { nombre: string; avatar_url: string | null } | { nombre: string; avatar_url: string | null }[] | null;
    pending?: boolean;
};

function normalizeProfile(perfiles: ChatMessage['perfiles']) {
    if (!perfiles) return null;
    if (Array.isArray(perfiles)) return perfiles[0] ?? null;
    return perfiles;
}

function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, totalSeconds);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseStoredDuration(contenido: string): number | null {
    if (!contenido || !/^\d+$/.test(contenido.trim())) return null;
    const value = parseInt(contenido, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

type Props = {
    item: ChatMessage;
    currentUserId: string | null;
    isPlaying: boolean;
    audioDurationSec?: number;
    reactions: MessageReaction[];
    videoLabel: string;
    /** Amigo (verde) o conocido (morado) en el avatar. */
    relation?: 'friend' | 'acquaintance' | null;
    onOpenProfile: (userId: string) => void;
    onOpenImage: (uri: string) => void;
    onOpenVideo: (uri: string) => void;
    onPlayAudio: (messageId: string, url: string) => void;
    /** Mantener pulsado → reaccionar */
    onLongPressMessage: (messageId: string) => void;
    /** Deslizar a la derecha → responder */
    onReplyMessage: (messageId: string) => void;
    onPickReaction: (messageId: string, emoji: string) => void;
};

function ChatMessageRowInner({
    item,
    currentUserId,
    isPlaying,
    audioDurationSec,
    reactions,
    videoLabel,
    relation,
    onOpenProfile,
    onOpenImage,
    onOpenVideo,
    onPlayAudio,
    onLongPressMessage,
    onReplyMessage,
    onPickReaction,
}: Props) {
    const isMe = item.emisor_id === currentUserId;
    const profile = normalizeProfile(item.perfiles);
    const nombreMostrar = profile?.nombre || 'Usuario';
    const translateX = useSharedValue(0);
    const replyTriggered = useSharedValue(false);
    const rowReactions = useMemo(
        () => reactions.filter((r) => r.mensaje_id === item.id),
        [reactions, item.id],
    );
    const { reply, text: plainText } = useMemo(
        () => (item.tipo === 'texto' ? parseReplyContent(item.contenido) : { reply: null, text: item.contenido }),
        [item.contenido, item.tipo],
    );

    const fireReply = () => {
        hapticMedium();
        onReplyMessage(item.id);
    };

    const pan = Gesture.Pan()
        .activeOffsetX(10)
        .failOffsetY([-14, 14])
        .onBegin(() => {
            replyTriggered.value = false;
        })
        .onUpdate((e) => {
            const x = Math.max(0, Math.min(e.translationX, MAX_DRAG));
            translateX.value = x;
            if (!replyTriggered.value && x >= REPLY_THRESHOLD) {
                replyTriggered.value = true;
                runOnJS(fireReply)();
            }
        })
        .onEnd(() => {
            translateX.value = withSpring(0, { damping: 22, stiffness: 320, mass: 0.6 });
        })
        .onFinalize(() => {
            translateX.value = withSpring(0, { damping: 22, stiffness: 320, mass: 0.6 });
        });

    const rowStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    const replyHintStyle = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, 18, REPLY_THRESHOLD], [0, 0.55, 1], Extrapolation.CLAMP),
        transform: [
            {
                scale: interpolate(translateX.value, [0, REPLY_THRESHOLD], [0.7, 1], Extrapolation.CLAMP),
            },
        ],
    }));

    const content = (() => {
        if (item.tipo === 'imagen' && item.archivo_url) {
            return (
                <TouchableOpacity onPress={() => onOpenImage(item.archivo_url!)}>
                    <Image
                        source={{ uri: item.archivo_url }}
                        style={styles.mediaImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={item.id}
                        transition={0}
                    />
                </TouchableOpacity>
            );
        }

        if (item.tipo === 'video' && item.archivo_url) {
            return (
                <TouchableOpacity style={styles.videoContainer} onPress={() => onOpenVideo(item.archivo_url!)}>
                    <View style={styles.videoPlaceholder}>
                        <Ionicons name="play-circle" size={48} color="#FFF" />
                        <Text style={styles.videoLabel}>{videoLabel}</Text>
                    </View>
                </TouchableOpacity>
            );
        }

        if (item.tipo === 'audio' && item.archivo_url) {
            const storedDuration = parseStoredDuration(item.contenido);
            const durationSec = storedDuration ?? audioDurationSec;
            const durationLabel = durationSec ? formatDuration(durationSec) : '--:--';

            return (
                <TouchableOpacity
                    style={styles.audioContainer}
                    onPress={() => onPlayAudio(item.id, item.archivo_url!)}
                >
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={isMe ? '#FFF' : PRIMARY_DARK} />
                    <View style={styles.audioInfo}>
                        <Text style={[styles.audioText, isMe ? styles.myMsgText : styles.otherMsgText]}>
                            {isPlaying ? 'Reproduciendo' : 'Nota de voz'}
                        </Text>
                        <Text style={[styles.audioDuration, isMe ? styles.myTime : styles.otherTime]}>
                            {durationLabel}
                        </Text>
                    </View>
                </TouchableOpacity>
            );
        }

        return (
            <>
                {reply ? (
                    <View style={[styles.quoteBox, isMe ? styles.quoteBoxMe : styles.quoteBoxOther]}>
                        <Text style={[styles.quoteName, isMe && styles.quoteNameMe]} numberOfLines={1}>
                            {reply.name}
                        </Text>
                        <Text style={[styles.quotePreview, isMe && styles.quotePreviewMe]} numberOfLines={2}>
                            {reply.preview}
                        </Text>
                    </View>
                ) : null}
                <Text style={[styles.msgText, isMe ? styles.myMsgText : styles.otherMsgText]}>
                    {plainText}
                </Text>
            </>
        );
    })();

    return (
        <View style={styles.swipeWrap}>
            <Animated.View style={[styles.replyHint, replyHintStyle]} pointerEvents="none">
                <View style={styles.replyHintCircle}>
                    <Ionicons name="arrow-undo" size={16} color={PRIMARY_DARK} />
                </View>
            </Animated.View>
            <GestureDetector gesture={pan}>
                <Animated.View style={rowStyle}>
                    <View style={[styles.msgContainer, isMe ? styles.myMsgContainer : styles.otherMsgContainer]}>
                        {!isMe ? (
                            <TouchableOpacity style={styles.avatarWrap} onPress={() => onOpenProfile(item.emisor_id)}>
                                <View
                                    style={[
                                        styles.avatarRing,
                                        relation === 'friend' && styles.avatarRingFriend,
                                        relation === 'acquaintance' && styles.avatarRingAcquaintance,
                                    ]}
                                >
                                    <ProfileAvatar
                                        uri={profile?.avatar_url}
                                        name={nombreMostrar}
                                        size={30}
                                        recyclingKey={item.emisor_id}
                                    />
                                </View>
                            </TouchableOpacity>
                        ) : null}
                        <View style={styles.bubbleCol}>
                            <TouchableOpacity
                                activeOpacity={0.9}
                                delayLongPress={280}
                                onLongPress={() => {
                                    hapticSelection();
                                    onLongPressMessage(item.id);
                                }}
                                style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble]}
                            >
                                {!isMe ? (
                                    <Text
                                        style={[
                                            styles.senderName,
                                            relation === 'friend' && styles.senderNameFriend,
                                            relation === 'acquaintance' && styles.senderNameAcquaintance,
                                        ]}
                                    >
                                        {nombreMostrar}
                                    </Text>
                                ) : null}
                                {content}
                                <View style={styles.timeRow}>
                                    {item.pending ? (
                                        <Ionicons
                                            name="time-outline"
                                            size={12}
                                            color={isMe ? 'rgba(255,255,255,0.75)' : '#94A3B8'}
                                            style={{ marginRight: 4 }}
                                        />
                                    ) : null}
                                    <Text style={[styles.timeText, isMe ? styles.myTime : styles.otherTime]}>
                                        {new Date(item.creado_en).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                            <MessageReactionChips
                                messageId={item.id}
                                userId={currentUserId}
                                reactions={rowReactions}
                                onPick={(emoji) => onPickReaction(item.id, emoji)}
                                alignRight={isMe}
                            />
                        </View>
                        {isMe ? (
                            <View style={styles.avatarWrapMe}>
                                <ProfileAvatar
                                    uri={profile?.avatar_url}
                                    name={nombreMostrar}
                                    size={30}
                                    recyclingKey={item.emisor_id}
                                />
                            </View>
                        ) : null}
                    </View>
                </Animated.View>
            </GestureDetector>
        </View>
    );
}

function reactionsSignature(messageId: string, reactions: MessageReaction[]) {
    let sig = '';
    for (const r of reactions) {
        if (r.mensaje_id === messageId) sig += `${r.usuario_id}:${r.emoji};`;
    }
    return sig;
}

export const ChatMessageRow = memo(ChatMessageRowInner, (prev, next) => {
    return (
        prev.item.id === next.item.id &&
        prev.item.contenido === next.item.contenido &&
        prev.item.archivo_url === next.item.archivo_url &&
        prev.item.tipo === next.item.tipo &&
        prev.item.pending === next.item.pending &&
        prev.currentUserId === next.currentUserId &&
        prev.isPlaying === next.isPlaying &&
        prev.audioDurationSec === next.audioDurationSec &&
        prev.videoLabel === next.videoLabel &&
        reactionsSignature(prev.item.id, prev.reactions) === reactionsSignature(next.item.id, next.reactions)
    );
});

export function chatMessageItemType(item: ChatMessage): string {
    return item.tipo;
}

const styles = StyleSheet.create({
    swipeWrap: {
        width: '100%',
        justifyContent: 'center',
    },
    replyHint: {
        position: 'absolute',
        left: 10,
        top: 0,
        bottom: 10,
        justifyContent: 'center',
        zIndex: 0,
    },
    replyHintCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    msgContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 10,
        maxWidth: '88%',
    },
    myMsgContainer: { alignSelf: 'flex-end' },
    otherMsgContainer: { alignSelf: 'flex-start' },
    avatarWrap: { marginRight: 8 },
    avatarWrapMe: { marginLeft: 8 },
    avatarRing: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    avatarRingFriend: { borderColor: FRIEND, backgroundColor: '#ECFDF5' },
    avatarRingAcquaintance: { borderColor: ACQUAINTANCE, backgroundColor: '#F5F3FF' },
    senderNameFriend: { color: '#047857' },
    senderNameAcquaintance: { color: '#6D28D9' },
    bubbleCol: { maxWidth: '80%', flexShrink: 1 },
    bubble: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        elevation: 0,
        flexShrink: 1,
        shadowOpacity: 0,
    },
    myBubble: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
    otherBubble: {
        backgroundColor: '#FFF',
        borderBottomLeftRadius: 4,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#E2E8F0',
    },
    senderName: { fontSize: 12, fontWeight: '700', color: PRIMARY_DARK, marginBottom: 3 },
    msgText: { fontSize: 15, lineHeight: 21, color: '#0F172A' },
    myMsgText: { color: '#FFF' },
    otherMsgText: { color: '#0F172A' },
    quoteBox: {
        borderLeftWidth: 3,
        paddingLeft: 8,
        marginBottom: 6,
        paddingVertical: 2,
    },
    quoteBoxMe: { borderLeftColor: 'rgba(255,255,255,0.65)' },
    quoteBoxOther: { borderLeftColor: PRIMARY },
    quoteName: { fontSize: 11, fontWeight: '800', color: PRIMARY_DARK },
    quoteNameMe: { color: '#FFF' },
    quotePreview: { fontSize: 12, color: '#64748B', marginTop: 1 },
    quotePreviewMe: { color: 'rgba(255,255,255,0.85)' },
    timeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4 },
    timeText: { fontSize: 10, color: '#94A3B8' },
    myTime: { color: 'rgba(255, 255, 255, 0.75)' },
    otherTime: { color: '#94A3B8' },
    mediaImage: { width: 220, height: 220, borderRadius: 14, backgroundColor: '#E2E8F0' },
    videoContainer: { width: 220, borderRadius: 14, overflow: 'hidden' },
    videoPlaceholder: {
        height: 140,
        backgroundColor: '#0F172A',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    videoLabel: { color: '#FFF', fontWeight: '700', fontSize: 13 },
    audioContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 140 },
    audioInfo: { flex: 1 },
    audioText: { fontSize: 14, fontWeight: '700' },
    audioDuration: { fontSize: 11, marginTop: 2 },
});
