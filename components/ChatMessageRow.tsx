import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { MessageReactionChips } from './MessageReactionsBar';
import { PlanMomentsMessage } from './PlanMomentsMessage';
import { linkifyParts } from './LinkifiedText';
import { parseMoments, type MomentItem } from '../lib/planMoments';
import { ProfileAvatar } from './ProfileAvatar';
import { hapticMedium, hapticSelection } from '../lib/haptics';
import { parseReplyContent } from '../lib/chatReply';
import { parseSystemContent } from '../lib/chatSystem';
import { parsePlanInviteCard, type PlanInviteCardPayload } from '../lib/chatPlanInviteCard';
import { isDeletedMessage } from '../lib/softDeleteMessage';
import {
    peekInviteCardPeople,
    refreshInviteCardPeople,
    retainInviteCardPeopleChannel,
    subscribeInviteCardPeople,
} from '../lib/inviteCardPeopleBus';
import { useT } from '../lib/i18n';
import type { MessageReaction } from '../lib/messageReactions';
import { PlanInviteCardMessage } from './PlanInviteCardMessage';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const REPLY_THRESHOLD = 44;
const MAX_DRAG = 64;
const REPLY_SPRING = { damping: 22, stiffness: 320, mass: 0.6 } as const;

export type ChatMessage = {
    id: string;
    contenido: string;
    emisor_id: string;
    creado_en: string;
    tipo: 'texto' | 'imagen' | 'video' | 'audio';
    archivo_url: string | null;
    perfiles: { nombre: string; avatar_url: string | null } | { nombre: string; avatar_url: string | null }[] | null;
    pending?: boolean;
    eliminado_en?: string | null;
    clientKey?: string;
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

function stripReplyPreview(preview: string): string {
    if (!preview.includes('@@nexo_reply:')) return preview;
    const parsed = parseReplyContent(preview);
    if (parsed.reply) return parsed.text.trim() || preview;
    const end = preview.indexOf('@@\n');
    if (end >= 0) return preview.slice(end + 3).trim();
    return preview.replace(/@@nexo_reply:/g, '').trim();
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
    onOpenProfile: (userId: string) => void;
    onOpenImage: (uri: string) => void;
    onOpenVideo: (uri: string) => void;
    onPlayAudio: (messageId: string, url: string) => void;
    /** Mantener pulsado → reaccionar */
    onLongPressMessage: (messageId: string) => void;
    /** Deslizar a la derecha → responder */
    onReplyMessage: (messageId: string) => void;
    onPickReaction: (messageId: string, emoji: string) => void;
    onOpenMoments?: (items: MomentItem[]) => void;
    onOpenPlan?: (planId: string) => void;
    onInviteCardGone?: (messageId: string) => void;
};

function SystemMessageRow({
    isMe,
    systemKind,
    nombreMostrar,
}: {
    isMe: boolean;
    systemKind: 'join_plan' | 'join_group';
    nombreMostrar: string;
}) {
    const { t } = useT();
    const label = isMe
        ? systemKind === 'join_group'
            ? t('chat.systemJoinedGroupSelf')
            : t('chat.systemJoinedPlanSelf')
        : systemKind === 'join_group'
          ? t('chat.systemJoinedGroup', { name: nombreMostrar })
          : t('chat.systemJoinedPlan', { name: nombreMostrar });
    return (
        <View style={styles.systemWrap}>
            <Text style={styles.systemText}>{label}</Text>
        </View>
    );
}

/** Un mensaje roto se oculta en lugar de tumbar toda la app. */
class MessageRowBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        if (__DEV__) console.error('ChatMessageRow:', error);
    }

    render() {
        if (this.state.failed) return null;
        return this.props.children;
    }
}

function ChatMessageRowInner(props: Props) {
    return <MessageRowBoundary>{renderMessageRow(props)}</MessageRowBoundary>;
}

function LivePlanInviteCard(props: {
    inviteCard: PlanInviteCardPayload;
    messageId: string;
    currentUserId: string | null;
    onOpenPlan?: (planId: string) => void;
    onGone?: () => void;
}) {
    const { inviteCard, messageId, currentUserId, onOpenPlan, onGone } = props;
    const [liveMembers, setLiveMembers] = useState(
        () => peekInviteCardPeople(inviteCard.planId) ?? inviteCard.members ?? [],
    );

    useEffect(() => {
        const apply = (planId: string) => {
            if (planId !== inviteCard.planId) return;
            const next = peekInviteCardPeople(planId);
            if (next) setLiveMembers(next);
        };
        apply(inviteCard.planId);
        const unsub = subscribeInviteCardPeople(apply);
        const release = retainInviteCardPeopleChannel(inviteCard.planId);
        void refreshInviteCardPeople(inviteCard.planId);
        return () => {
            unsub();
            release();
        };
    }, [inviteCard.planId]);

    const membersKey = liveMembers.map((m) => m.id).join(',');
    const payload: PlanInviteCardPayload = {
        ...inviteCard,
        members: liveMembers.length ? liveMembers : inviteCard.members,
    };

    return (
        <PlanInviteCardMessage
            key={`${messageId}:${membersKey}`}
            payload={payload}
            messageId={messageId}
            currentUserId={currentUserId}
            onOpenPlan={onOpenPlan}
            onGone={onGone}
        />
    );
}

function renderMessageRow(props: Props) {
    if (isDeletedMessage(props.item)) {
        return <DeletedChatMessageRow {...props} />;
    }
    const inviteCard = props.item.tipo === 'texto' ? parsePlanInviteCard(props.item.contenido) : null;
    if (inviteCard) {
        return (
            <LivePlanInviteCard
                inviteCard={inviteCard}
                messageId={props.item.id}
                currentUserId={props.currentUserId}
                onOpenPlan={props.onOpenPlan}
                onGone={() => props.onInviteCardGone?.(props.item.id)}
            />
        );
    }

    const systemKind =
        props.item.tipo === 'texto' ? parseSystemContent(props.item.contenido) : null;
    if (systemKind) {
        const profile = normalizeProfile(props.item.perfiles);
        return (
            <SystemMessageRow
                isMe={props.item.emisor_id === props.currentUserId}
                systemKind={systemKind}
                nombreMostrar={profile?.nombre || 'Usuario'}
            />
        );
    }

    return <NormalChatMessageRow {...props} />;
}

function DeletedChatMessageRow({ item, currentUserId, onOpenProfile }: Props) {
    const { t } = useT();
    const isMe = item.emisor_id === currentUserId;
    const profile = normalizeProfile(item.perfiles);
    const nombreMostrar = profile?.nombre || 'Usuario';
    const timeLabel = new Date(item.creado_en).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
    return (
        <View style={[styles.msgContainer, isMe ? styles.myMsgContainer : styles.otherMsgContainer]}>
            {!isMe ? (
                <TouchableOpacity style={styles.avatarWrap} onPress={() => onOpenProfile(item.emisor_id)}>
                    <ProfileAvatar
                        uri={profile?.avatar_url}
                        name={nombreMostrar}
                        size={30}
                        recyclingKey={item.emisor_id}
                    />
                </TouchableOpacity>
            ) : null}
            <View style={styles.bubbleCol}>
                <View style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble, styles.deletedBubble]}>
                    {!isMe ? <Text style={styles.senderName}>{nombreMostrar}</Text> : null}
                    <Text
                        style={[
                            styles.msgText,
                            styles.deletedText,
                            styles.msgTextTight,
                            isMe ? styles.myMsgText : styles.otherMsgText,
                        ]}
                    >
                        {t('chat.messageDeleted')}
                        {Platform.OS !== 'android' ? <Text style={styles.timeGhost}>{` ${timeLabel}`}</Text> : null}
                    </Text>
                    <View style={[Platform.OS === 'android' ? styles.timeRow : isMe ? styles.timeAbsoluteMe : styles.timeAbsolute]}>
                        <Text style={[styles.timeText, isMe ? styles.myTime : styles.otherTime]}>
                            {timeLabel}
                        </Text>
                    </View>
                </View>
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
    );
}

const SEND_ENTER_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.99);
const SEND_ENTER_KEYS = new Set<string>();
const SEND_ENTER_ORDER: string[] = [];

function claimSendEnterAnim(key: string, createdAt: string, isMe: boolean): boolean {
    if (!isMe) return false;
    const created = new Date(createdAt).getTime();
    if (!Number.isFinite(created) || Date.now() - created > 1800) return false;
    if (SEND_ENTER_KEYS.has(key)) return false;
    SEND_ENTER_KEYS.add(key);
    SEND_ENTER_ORDER.push(key);
    if (SEND_ENTER_ORDER.length > 60) {
        const drop = SEND_ENTER_ORDER.splice(0, SEND_ENTER_ORDER.length - 40);
        for (const k of drop) SEND_ENTER_KEYS.delete(k);
    }
    return true;
}

function NormalChatMessageRow({
    item,
    currentUserId,
    isPlaying,
    audioDurationSec,
    reactions,
    videoLabel,
    onOpenProfile,
    onOpenImage,
    onOpenVideo,
    onOpenMoments,
    onPlayAudio,
    onLongPressMessage,
    onReplyMessage,
    onPickReaction,
}: Props) {
    const isMe = item.emisor_id === currentUserId;
    const profile = normalizeProfile(item.perfiles);
    const nombreMostrar = profile?.nombre || 'Usuario';
    const translateX = useSharedValue(0);
    const crossedReplyRef = useSharedValue(false);
    const enterOnce = useRef<boolean | null>(null);
    if (enterOnce.current === null) {
        enterOnce.current = claimSendEnterAnim(item.clientKey ?? item.id, item.creado_en, isMe);
    }
    const enterOpacity = useSharedValue(enterOnce.current ? 0 : 1);
    const enterY = useSharedValue(enterOnce.current ? 14 : 0);
    const onReplyRef = useRef(onReplyMessage);
    const itemIdRef = useRef(item.id);
    onReplyRef.current = onReplyMessage;
    itemIdRef.current = item.id;

    const rowReactions = useMemo(
        () => reactions.filter((r) => r.mensaje_id === item.id),
        [reactions, item.id],
    );
    const { reply, text: plainText } = useMemo(
        () => (item.tipo === 'texto' ? parseReplyContent(item.contenido) : { reply: null, text: item.contenido }),
        [item.contenido, item.tipo],
    );
    const timeLabel = useMemo(
        () =>
            new Date(item.creado_en).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            }),
        [item.creado_en],
    );

    useEffect(() => {
        if (enterOnce.current) {
            enterOpacity.value = withTiming(1, { duration: 220, easing: SEND_ENTER_EASING });
            enterY.value = withTiming(0, { duration: 260, easing: SEND_ENTER_EASING });
            return;
        }
        enterOpacity.value = 1;
        enterY.value = 0;
    }, [enterOpacity, enterY]);

    const fireReply = useCallback(() => {
        hapticMedium();
        onReplyRef.current(itemIdRef.current);
    }, []);

    // Solo UI-thread mientras deslizas; el JS (haptic + reply) al soltar. Evita el tirón del 1er swipe.
    const pan = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX(16)
                .failOffsetY([-16, 16])
                .onBegin(() => {
                    crossedReplyRef.value = false;
                })
                .onUpdate((e) => {
                    const x = Math.max(0, Math.min(e.translationX, MAX_DRAG));
                    translateX.value = x;
                    if (x >= REPLY_THRESHOLD) {
                        crossedReplyRef.value = true;
                    }
                })
                .onFinalize(() => {
                    const shouldReply = crossedReplyRef.value;
                    crossedReplyRef.value = false;
                    translateX.value = withSpring(0, REPLY_SPRING);
                    if (shouldReply) {
                        runOnJS(fireReply)();
                    }
                }),
        [crossedReplyRef, fireReply, translateX],
    );

    const rowStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    const enterStyle = useAnimatedStyle(() => ({
        opacity: enterOpacity.value,
        transform: [{ translateY: enterY.value }],
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
        const moments = parseMoments(item.contenido);
        if (moments) {
            return (
                <PlanMomentsMessage
                    items={moments}
                    onOpen={(next) => onOpenMoments?.(next)}
                />
            );
        }
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
                            {stripReplyPreview(reply.preview)}
                        </Text>
                    </View>
                ) : null}
                <Text
                    style={[
                        styles.msgText,
                        styles.msgTextTight,
                        isMe ? styles.myMsgText : styles.otherMsgText,
                    ]}
                >
                    {linkifyParts(plainText).map((part, index) =>
                        part.href ? (
                            <Text
                                key={`${index}-${part.href}`}
                                style={isMe ? styles.myLink : styles.otherLink}
                                onPress={() => {
                                    void Linking.openURL(part.href!);
                                }}
                            >
                                {part.text}
                            </Text>
                        ) : (
                            part.text
                        ),
                    )}
                    {/* Fantasma: solo la última línea deja hueco; el resto llega hasta la hora. */}
                    {Platform.OS !== 'android' ? (
                        <Text style={styles.timeGhost}>
                            {item.pending ? `  ··· ${timeLabel}` : ` ${timeLabel}`}
                        </Text>
                    ) : null}
                </Text>
            </>
        );
    })();

    const isMoments = parseMoments(item.contenido) != null;
    const isPlainText = item.tipo === 'texto';

    const timeNode = (
        <View
            style={[
                isPlainText && Platform.OS !== 'android'
                    ? isMe
                        ? styles.timeAbsoluteMe
                        : styles.timeAbsolute
                    : styles.timeRow,
            ]}
        >
            {item.pending ? (
                <Ionicons
                    name="time-outline"
                    size={12}
                    color={isMe ? 'rgba(255,255,255,0.75)' : '#94A3B8'}
                    style={{ marginRight: 4 }}
                />
            ) : null}
            <Text style={[styles.timeText, isMoments ? styles.otherTime : isMe ? styles.myTime : styles.otherTime]}>{timeLabel}</Text>
        </View>
    );

    return (
        <Animated.View style={[styles.swipeWrap, enterStyle]}>
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
                                <ProfileAvatar
                                    uri={profile?.avatar_url}
                                    name={nombreMostrar}
                                    size={30}
                                    recyclingKey={item.emisor_id}
                                />
                            </TouchableOpacity>
                        ) : null}
                        <View style={styles.bubbleCol}>
                            <Pressable
                                delayLongPress={280}
                                onLongPress={() => {
                                    hapticSelection();
                                    onLongPressMessage(item.id);
                                }}
                                style={[
                                    styles.bubble,
                                    isMoments ? styles.momentsBubble : isMe ? styles.myBubble : styles.otherBubble,
                                ]}
                            >
                                {!isMe ? (
                                    <Text style={styles.senderName}>{nombreMostrar}</Text>
                                ) : null}
                                {content}
                                {timeNode}
                            </Pressable>
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
        </Animated.View>
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
    const prevProfile = normalizeProfile(prev.item.perfiles);
    const nextProfile = normalizeProfile(next.item.perfiles);
    return (
        prev.item.id === next.item.id &&
        prev.item.contenido === next.item.contenido &&
        prev.item.archivo_url === next.item.archivo_url &&
        prev.item.tipo === next.item.tipo &&
        prev.item.eliminado_en === next.item.eliminado_en &&
        prev.item.pending === next.item.pending &&
        prevProfile?.nombre === nextProfile?.nombre &&
        prevProfile?.avatar_url === nextProfile?.avatar_url &&
        prev.currentUserId === next.currentUserId &&
        prev.isPlaying === next.isPlaying &&
        prev.audioDurationSec === next.audioDurationSec &&
        prev.videoLabel === next.videoLabel &&
        reactionsSignature(prev.item.id, prev.reactions) === reactionsSignature(next.item.id, next.reactions)
    );
});

export function chatMessageItemType(item: ChatMessage): string {
    if (isDeletedMessage(item)) return 'deleted';
    if (item.tipo === 'texto' && parsePlanInviteCard(item.contenido)) return 'plan_invite_card';
    if (item.tipo === 'texto' && parseSystemContent(item.contenido)) return 'system';
    return item.tipo;
}

const styles = StyleSheet.create({
    systemWrap: {
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 8,
        marginBottom: 6,
    },
    systemText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 18,
    },
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
    bubbleCol: { maxWidth: '80%', flexShrink: 1 },
    momentsBubble: {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderWidth: 0,
    },
    bubble: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        elevation: 0,
        flexShrink: 1,
        shadowOpacity: 0,
        overflow: 'visible',
    },
    myBubble: {
        backgroundColor: PRIMARY,
        borderBottomRightRadius: 4,
        paddingLeft: 12,
        paddingRight: 8,
    },
    otherBubble: {
        backgroundColor: '#FFFFFF',
        borderBottomLeftRadius: 4,
        paddingRight: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#E2E8F0',
    },
    deletedBubble: { opacity: 0.92 },
    deletedText: { fontStyle: 'italic', opacity: 0.85 },
    senderName: { fontSize: 15, fontWeight: '700', color: PRIMARY_DARK, marginBottom: 3 },
    msgText: { fontSize: 17, lineHeight: 23, color: '#0F172A' },
    /**
     * Casi sin padding; el hueco de la hora lo da el texto fantasma solo en la
     * última línea (tuyas y de otros), para que el resto llegue hasta la hora.
     */
    msgTextTight: { paddingRight: 2, paddingBottom: 1 },
    /**
     * Reserva el ancho de la hora en la última línea.
     * En Android, `color: 'transparent'` en Text anidado hereda el color del padre
     * y la hora se ve duplicada; opacity: 0 sí la oculta en todos los dispositivos.
     */
    timeGhost: {
        fontSize: 12,
        lineHeight: 23,
        color: 'rgba(0,0,0,0)',
        opacity: 0,
    },
    myMsgText: { color: '#FFF' },
    myLink: { color: '#BFDBFE', fontWeight: '700', textDecorationLine: 'underline' },
    otherLink: { color: '#2563EB', fontWeight: '700', textDecorationLine: 'underline' },
    otherMsgText: { color: '#0F172A' },
    quoteBox: {
        borderLeftWidth: 3,
        paddingLeft: 8,
        marginBottom: 6,
        paddingVertical: 2,
    },
    quoteBoxMe: { borderLeftColor: 'rgba(255,255,255,0.65)' },
    quoteBoxOther: { borderLeftColor: PRIMARY },
    quoteName: { fontSize: 13, fontWeight: '800', color: PRIMARY_DARK },
    quoteNameMe: { color: '#FFF' },
    quotePreview: { fontSize: 14, color: '#64748B', marginTop: 1 },
    quotePreviewMe: { color: 'rgba(255,255,255,0.85)' },
    timeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2 },
    timeAbsolute: {
        position: 'absolute',
        right: 10,
        bottom: 7,
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeAbsoluteMe: {
        position: 'absolute',
        right: 7,
        bottom: 7,
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeText: { fontSize: 12, color: '#94A3B8' },
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
