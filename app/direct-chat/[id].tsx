import {
    Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { Audio,
    ResizeMode,
    Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams,
    useRouter,
    useFocusEffect } from 'expo-router';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { theme } from '../../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMessageRow, chatMessageItemType } from '../../components/ChatMessageRow';
import { ReactionEmojiPicker, applyMessageReaction, useMessageReactions } from '../../components/MessageReactionsBar';
import { getAuthUser } from '../../lib/auth';
import {
    isSameChatFile,
    resolveChatFileUrl,
    resolveChatFileUrls,
    uploadChatFile,
} from '../../lib/chatUpload';
import { markDirectChatRead } from '../../lib/chatUnread';
import { hideDirectChat } from '../../lib/directChat';
import { setActiveConversation } from '../../lib/activeConversation';
import {
    enqueueChatOutbox,
    flushChatOutbox,
    subscribeOutboxFlush,
} from '../../lib/chatOutbox';
import { encodeReplyContent, previewForReply, type ReplyQuote } from '../../lib/chatReply';
import { hapticMedium } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { getIsOnline } from '../../lib/network';
import { cacheGetStale, cacheInvalidate, cacheSet } from '../../lib/ttlCache';
import { supabase } from '../../lib/supabase';

const PRIMARY = theme.colors.brand;
const DANGER = theme.colors.danger;
const PAGE_SIZE = 50;
const DIRECT_CHAT_TTL_MS = 15 * 60 * 1000;
const directChatKey = (a: string, b: string) => {
    const [x, y] = [a, b].sort();
    return `directChat:${x}:${y}`;
};

interface MessageProfile {
    nombre: string;
    avatar_url: string | null;
}

interface Message {
    id: string;
    contenido: string;
    emisor_id: string;
    creado_en: string;
    tipo: 'texto' | 'imagen' | 'video' | 'audio';
    archivo_url: string | null;
    perfiles: MessageProfile | MessageProfile[] | null;
    pending?: boolean;
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

function mapMessageRow(row: Record<string, unknown>): Message {
    return {
        id: row.id as string,
        contenido: (row.contenido as string) ?? '',
        emisor_id: row.emisor_id as string,
        creado_en: row.creado_en as string,
        tipo: (row.tipo as Message['tipo']) ?? 'texto',
        archivo_url: (row.archivo_url as string | null) ?? null,
        perfiles: row.perfiles as Message['perfiles'],
    };
}

function mergeMessages(a: Message[], b: Message[]): Message[] {
    const map = new Map<string, Message>();
    for (const m of [...a, ...b]) map.set(m.id, m);
    return Array.from(map.values()).sort(
        (x, y) => new Date(y.creado_en).getTime() - new Date(x.creado_en).getTime(),
    );
}

type DirectChatSnapshot = {
    messages: Message[];
    otherUserName: string;
    otherUserAvatar: string | null;
    hasMore: boolean;
};

export default function DirectChatScreen() {
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const otherUserId = Array.isArray(id) ? id[0] : id;
    const router = useRouter();
    const { t } = useT();
    const headerHeight = useHeaderHeight();
    const insets = useSafeAreaInsets();

    const [otherUserName, setOtherUserName] = useState(() => '…');
    const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null);
    const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
    const [messageText, setMessageText] = useState('');
    const [replyTo, setReplyTo] = useState<ReplyQuote | null>(null);
    const [typingNames, setTypingNames] = useState<string[]>([]);
    const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const cacheUserPairRef = useRef<string | null>(null);

    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
    const [modalImage, setModalImage] = useState<string | null>(null);
    const [modalVideo, setModalVideo] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
    const [recordingDuration, setRecordingDuration] = useState(0);

    const soundRef = useRef<Audio.Sound | null>(null);
    const isMountedRef = useRef(true);
    const loadingDurationsRef = useRef<Set<string>>(new Set());
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const [myProfile, setMyProfile] = useState<{ nombre: string; avatar_url: string | null }>({
        nombre: 'Yo',
        avatar_url: null,
    });

    const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
    const { reactions, setReactions } = useMessageReactions(messageIds);

    const stopAudio = useCallback(async () => {
        if (soundRef.current) {
            await soundRef.current.unloadAsync();
            soundRef.current = null;
        }
        setPlayingMessageId(null);
    }, []);

    const fetchMessages = useCallback(
        async (before?: string) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !otherUserId) return [];

            let query = supabase
                .from('mensajes')
                .select(`
                    id,
                    contenido,
                    emisor_id,
                    creado_en,
                    tipo,
                    archivo_url,
                    perfiles:perfiles!mensajes_emisor_fkey (
                        nombre,
                        avatar_url
                    )
                `)
                .is('plan_id', null)
                .or(`and(emisor_id.eq.${user.id},receptor_id.eq.${otherUserId}),and(emisor_id.eq.${otherUserId},receptor_id.eq.${user.id})`)
                .order('creado_en', { ascending: false })
                .limit(PAGE_SIZE);

            if (before) {
                query = query.lt('creado_en', before);
            }

            const { data, error } = await query;
            if (error) throw error;

            const rows = (data ?? []).map((row) => mapMessageRow(row as Record<string, unknown>));
            return resolveChatFileUrls(rows);
        },
        [otherUserId]
    );

    const persistDirectChatCache = useCallback((
        userId: string,
        peerId: string,
        patch: Partial<DirectChatSnapshot> & { messages: Message[] },
    ) => {
        const key = directChatKey(userId, peerId);
        const prev = cacheGetStale<DirectChatSnapshot>(key);
        cacheSet(key, {
            messages: patch.messages,
            otherUserName: patch.otherUserName ?? prev?.otherUserName ?? 'Usuario',
            otherUserAvatar: patch.otherUserAvatar !== undefined
                ? patch.otherUserAvatar
                : (prev?.otherUserAvatar ?? null),
            hasMore: patch.hasMore ?? prev?.hasMore ?? true,
        }, DIRECT_CHAT_TTL_MS);
    }, []);

    const loadMoreMessages = useCallback(async () => {
        const current = messagesRef.current;
        if (!otherUserId || loadingMore || !hasMore || current.length === 0) return;

        setLoadingMore(true);
        try {
            const oldest = current[current.length - 1];
            const older = await fetchMessages(oldest.creado_en);

            const nextHasMore = older.length >= PAGE_SIZE;
            if (!nextHasMore) setHasMore(false);

            setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const unique = older.filter((m) => !existingIds.has(m.id));
                const next = [...prev, ...unique];
                if (currentUserId && otherUserId) {
                    persistDirectChatCache(currentUserId, otherUserId, {
                        messages: next,
                        hasMore: nextHasMore,
                    });
                }
                return next;
            });
        } catch (error) {
            if (__DEV__) console.error('Error cargando más mensajes:', error);
        } finally {
            setLoadingMore(false);
        }
    }, [otherUserId, loadingMore, hasMore, fetchMessages, currentUserId, persistDirectChatCache]);

    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            soundRef.current?.unloadAsync();
        };
    }, []);

    const loadAudioDuration = useCallback(async (messageId: string, audioUrl: string) => {
        if (loadingDurationsRef.current.has(messageId)) return;
        loadingDurationsRef.current.add(messageId);

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });
            const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: false });
            const status = await sound.getStatusAsync();
            await sound.unloadAsync();

            if (status.isLoaded && status.durationMillis) {
                const seconds = Math.max(1, Math.round(status.durationMillis / 1000));
                setAudioDurations((prev) => ({ ...prev, [messageId]: seconds }));
            }
        } catch {
            /* duración opcional; no molestar al usuario */
        } finally {
            loadingDurationsRef.current.delete(messageId);
        }
    }, []);

    useEffect(() => {
        messages.forEach((message) => {
            if (message.tipo !== 'audio' || !message.archivo_url) return;
            if (parseStoredDuration(message.contenido)) return;
            if (audioDurations[message.id]) return;
            loadAudioDuration(message.id, message.archivo_url);
        });
    }, [messages, audioDurations, loadAudioDuration]);

    useEffect(() => {
        if (!recording) {
            setRecordingDuration(0);
            return;
        }

        const interval = setInterval(async () => {
            try {
                const status = await recording.getStatusAsync();
                if (status.isRecording && status.durationMillis) {
                    setRecordingDuration(Math.floor(status.durationMillis / 1000));
                }
            } catch {
                // ignore polling errors while recording
            }
        }, 500);

        return () => clearInterval(interval);
    }, [recording]);

    useEffect(() => {
        if (!otherUserId) return;

        let channel: ReturnType<typeof supabase.channel> | null = null;

        const initChat = async () => {
            try {
                const user = await getAuthUser();
                if (!isMountedRef.current) return;

                if (!user) {
                    router.replace('/login');
                    return;
                }

                setCurrentUserId(user.id);
                cacheUserPairRef.current = directChatKey(user.id, otherUserId);

                const stale = cacheGetStale<DirectChatSnapshot>(directChatKey(user.id, otherUserId));
                if (stale?.messages?.length) {
                    setMessages(stale.messages);
                    setOtherUserName(stale.otherUserName);
                    setOtherUserAvatar(stale.otherUserAvatar);
                    setHasMore(stale.hasMore);
                    setLoading(false);
                } else {
                    setLoading(true);
                    setHasMore(true);
                }

                const [{ data: otherProfile }, { data: meProfile }] = await Promise.all([
                    supabase.from('perfiles').select('nombre, avatar_url').eq('id', otherUserId).single(),
                    supabase.from('perfiles').select('nombre, avatar_url').eq('id', user.id).maybeSingle(),
                ]);

                if (otherProfile) {
                    setOtherUserName(otherProfile.nombre);
                    setOtherUserAvatar(otherProfile.avatar_url);
                }
                if (meProfile) {
                    setMyProfile({
                        nombre: meProfile.nombre || t('chats.you'),
                        avatar_url: meProfile.avatar_url ?? null,
                    });
                }

                const initialMessages = await fetchMessages();

                if (!isMountedRef.current) return;

                const merged = mergeMessages(initialMessages, stale?.messages ?? []);
                setMessages(merged);
                const nextHasMore = initialMessages.length >= PAGE_SIZE || (stale?.hasMore ?? false);
                setHasMore(nextHasMore);
                void markDirectChatRead(user.id, otherUserId);

                persistDirectChatCache(user.id, otherUserId, {
                    messages: merged,
                    otherUserName: otherProfile?.nombre ?? stale?.otherUserName ?? 'Usuario',
                    otherUserAvatar: otherProfile?.avatar_url ?? stale?.otherUserAvatar ?? null,
                    hasMore: nextHasMore,
                });

                channel = supabase
                    .channel(`direct-chat:${user.id}:${otherUserId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'INSERT',
                            schema: 'public',
                            table: 'mensajes',
                            filter: `plan_id=is.null`,
                        },
                        async (payload) => {
                            const emisor = payload.new.emisor_id;
                            const receptor = payload.new.receptor_id;
                            const esDeEstaConversacion =
                                (emisor === user.id && receptor === otherUserId)
                                || (emisor === otherUserId && receptor === user.id);

                            if (!esDeEstaConversacion) return;

                            const newId = payload.new.id as string;

                            const { data: perfil } = await supabase
                                .from('perfiles')
                                .select('nombre, avatar_url')
                                .eq('id', payload.new.emisor_id)
                                .single();

                            const rawFileUrl = (payload.new.archivo_url as string | null) ?? null;
                            const newMessage: Message = {
                                id: newId,
                                contenido: (payload.new.contenido as string) ?? '',
                                emisor_id: payload.new.emisor_id as string,
                                creado_en: payload.new.creado_en as string,
                                tipo: (payload.new.tipo as Message['tipo']) ?? 'texto',
                                archivo_url: await resolveChatFileUrl(rawFileUrl),
                                perfiles: perfil,
                            };

                            if (isMountedRef.current) {
                                setMessages((prev) => {
                                    if (prev.some((m) => m.id === newMessage.id)) return prev;
                                    const withoutOptimistic = prev.filter(
                                        (m) =>
                                            !(
                                                m.id.startsWith('local-') &&
                                                m.emisor_id === newMessage.emisor_id &&
                                                m.tipo === newMessage.tipo &&
                                                m.contenido === newMessage.contenido &&
                                                isSameChatFile(m.archivo_url, rawFileUrl)
                                            ),
                                    );
                                    const next = [newMessage, ...withoutOptimistic];
                                    persistDirectChatCache(user.id, otherUserId, { messages: next });
                                    return next;
                                });
                            }
                        }
                    )
                    .subscribe();
            } catch (error) {
                console.error('Error en initChat:', error);
                if (!cacheUserPairRef.current || !cacheGetStale<DirectChatSnapshot>(cacheUserPairRef.current)?.messages?.length) {
                    Alert.alert(t('chat.errorTitle'), t('chat.loadError'));
                }
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        };

        initChat();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [otherUserId, router, fetchMessages, persistDirectChatCache, t]);

    useFocusEffect(
        useCallback(() => {
            if (otherUserId) setActiveConversation({ kind: 'direct', id: otherUserId });
            if (currentUserId && otherUserId) {
                void markDirectChatRead(currentUserId, otherUserId);
            }
            return () => {
                setActiveConversation(null);
                if (currentUserId && otherUserId) {
                    void markDirectChatRead(currentUserId, otherUserId);
                }
            };
        }, [currentUserId, otherUserId])
    );

    useEffect(() => {
        if (!otherUserId) return;
        const unsub = subscribeOutboxFlush((ev) => {
            if (ev.kind !== 'direct' || ev.receptorId !== otherUserId) return;
            if (!currentUserId) return;
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.id === ev.tempId
                        ? { ...m, id: ev.serverId, creado_en: ev.creadoEn, pending: false }
                        : m,
                );
                persistDirectChatCache(currentUserId, otherUserId, { messages: next });
                return next;
            });
        });
        if (getIsOnline()) void flushChatOutbox();
        return unsub;
    }, [currentUserId, otherUserId, persistDirectChatCache]);

    useEffect(() => {
        if (!currentUserId || !otherUserId) return;
        const [a, b] = [currentUserId, otherUserId].sort();
        const channel = supabase.channel(`typing:direct:${a}:${b}`);
        typingChannelRef.current = channel;
        const typingMap = new Map<string, { name: string; at: number }>();

        const refreshTyping = () => {
            const now = Date.now();
            const names: string[] = [];
            typingMap.forEach((v, id) => {
                if (id === currentUserId) return;
                if (now - v.at > 3500) typingMap.delete(id);
                else if (v.name) names.push(v.name);
            });
            setTypingNames(names.slice(0, 3));
        };

        channel
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                const uid = String(payload?.userId ?? '');
                const name = String(payload?.name ?? '');
                if (!uid || uid === currentUserId) return;
                typingMap.set(uid, { name: name || otherUserName || 'Alguien', at: Date.now() });
                refreshTyping();
            })
            .subscribe();

        const tick = setInterval(refreshTyping, 1000);
        return () => {
            clearInterval(tick);
            typingChannelRef.current = null;
            void supabase.removeChannel(channel);
        };
    }, [currentUserId, otherUserId, otherUserName]);

    const emitTyping = useCallback(() => {
        if (!currentUserId) return;
        void typingChannelRef.current?.send({
            type: 'broadcast',
            event: 'typing',
            payload: { userId: currentUserId, name: myProfile?.nombre || 'Alguien' },
        });
    }, [currentUserId, myProfile?.nombre]);

    const onMessageTextChange = useCallback(
        (text: string) => {
            setMessageText(text);
            if (!text.trim()) return;
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => emitTyping(), 350);
        },
        [emitTyping],
    );

    const sendMessage = async (
        tipo: 'texto' | 'imagen' | 'video' | 'audio' = 'texto',
        archivoUrl: string | null = null,
        audioDurationSec?: number
    ) => {
        if (!currentUserId || !otherUserId || isSending) return;

        const tempText = messageText.trim();
        if (tipo === 'texto' && !tempText) return;

        setIsSending(true);
        hapticMedium();
        const replySnapshot = tipo === 'texto' ? replyTo : null;
        if (tipo === 'texto') {
            setMessageText('');
            setReplyTo(null);
        }

        const contenidoPayload =
            tipo === 'texto'
                ? (replySnapshot ? encodeReplyContent(tempText, replySnapshot) : tempText)
                : tipo === 'audio' && audioDurationSec
                  ? String(audioDurationSec)
                  : '';

        const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const optimistic: Message = {
            id: tempId,
            contenido: contenidoPayload,
            emisor_id: currentUserId,
            creado_en: new Date().toISOString(),
            tipo,
            archivo_url: archivoUrl,
            perfiles: myProfile,
            pending: !getIsOnline() && tipo === 'texto',
        };
        setMessages((prev) => {
            const next = [optimistic, ...prev];
            persistDirectChatCache(currentUserId, otherUserId, { messages: next });
            return next;
        });

        if (!getIsOnline()) {
            if (tipo !== 'texto') {
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                setIsSending(false);
                Alert.alert(t('chat.errorTitle'), t('chat.sendError'));
                return;
            }
            await enqueueChatOutbox({
                tempId,
                kind: 'direct',
                receptorId: otherUserId,
                emisorId: currentUserId,
                contenido: contenidoPayload,
                tipo,
                archivoUrl,
                createdAt: optimistic.creado_en,
            });
            setIsSending(false);
            return;
        }

        const { data, error } = await supabase
            .from('mensajes')
            .insert({
                emisor_id: currentUserId,
                receptor_id: otherUserId,
                plan_id: null,
                contenido: contenidoPayload,
                tipo,
                archivo_url: archivoUrl,
            })
            .select('id, creado_en')
            .maybeSingle();

        setIsSending(false);

        if (error) {
            if (tipo === 'texto') {
                await enqueueChatOutbox({
                    tempId,
                    kind: 'direct',
                    receptorId: otherUserId,
                    emisorId: currentUserId,
                    contenido: contenidoPayload,
                    tipo,
                    archivoUrl,
                    createdAt: optimistic.creado_en,
                });
                setMessages((prev) => {
                    const next = prev.map((m) => (m.id === tempId ? { ...m, pending: true } : m));
                    persistDirectChatCache(currentUserId, otherUserId, { messages: next });
                    return next;
                });
                return;
            }
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            Alert.alert(t('chat.errorTitle'), t('chat.sendError'));
            return;
        }

        if (data?.id) {
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.id === tempId
                        ? {
                              ...m,
                              id: data.id as string,
                              creado_en: (data.creado_en as string) || m.creado_en,
                              pending: false,
                          }
                        : m,
                );
                persistDirectChatCache(currentUserId, otherUserId, { messages: next });
                return next;
            });
        }

        if (data?.id) {
            const { notifyDirectMessage } = await import('../../lib/push');
            notifyDirectMessage(otherUserId, String(data.id));
        }
    };

    const pickMedia = async () => {
        if (isUploading) return;

        const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permissionResult.granted) {
            Alert.alert(t('chat.permRequired'), t('chat.galleryPerm'));
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsEditing: false,
            quality: 0.8,
            videoMaxDuration: 120,
        });

        if (result.canceled || !otherUserId) return;

        const selectedAsset = result.assets[0];
        const fileType = selectedAsset.type === 'video' ? 'video' : 'image';
        const messageType = fileType === 'image' ? 'imagen' : 'video';

        setIsUploading(true);
        const uploadedUrl = await uploadChatFile(selectedAsset.uri, fileType, `direct-${currentUserId}-${otherUserId}`);
        setIsUploading(false);

        if (uploadedUrl) {
            await sendMessage(messageType, uploadedUrl);
        } else {
            Alert.alert(t('chat.errorTitle'), t('chat.uploadError'));
        }
    };

    const startRecording = async () => {
        if (isUploading) return;

        try {
            const permission = await Audio.requestPermissionsAsync();
            if (permission.status !== 'granted') {
                Alert.alert(t('chat.permRequired'), t('chat.micPerm'));
                return;
            }

            await stopAudio();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            const { recording: newRecording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            setRecording(newRecording);
        } catch (err) {
            console.error('Fallo al iniciar la grabación', err);
            Alert.alert(t('chat.errorTitle'), t('chat.recordError'));
        }
    };

    const stopRecording = async () => {
        if (!recording || !otherUserId) return;

        const activeRecording = recording;
        setRecording(null);

        try {
            const status = await activeRecording.getStatusAsync();
            const durationSec = Math.max(
                1,
                Math.round((status.durationMillis ?? recordingDuration * 1000) / 1000)
            );

            const uri = activeRecording.getURI();
            await activeRecording.stopAndUnloadAsync();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            if (!uri) return;

            setIsUploading(true);
            const uploadedUrl = await uploadChatFile(uri, 'audio', `direct-${currentUserId}-${otherUserId}`);
            setIsUploading(false);

            if (uploadedUrl) {
                await sendMessage('audio', uploadedUrl, durationSec);
            } else {
                Alert.alert(t('chat.errorTitle'), t('chat.voiceError'));
            }
        } catch (err) {
            console.error('Fallo al detener la grabación', err);
            setIsUploading(false);
        }
    };

    const handleActionPress = () => {
        if (isUploading || isSending) return;

        if (messageText.trim()) {
            sendMessage();
        } else if (recording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const playAudio = useCallback(async (messageId: string, audioUrl: string) => {
        try {
            if (playingMessageId === messageId) {
                await stopAudio();
                return;
            }

            await stopAudio();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            const { sound: newSound } = await Audio.Sound.createAsync(
                { uri: audioUrl },
                { shouldPlay: true }
            );

            soundRef.current = newSound;
            setPlayingMessageId(messageId);

            newSound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                    soundRef.current = null;
                    setPlayingMessageId(null);
                }
            });
        } catch (error) {
            if (__DEV__) console.error('Error reproduciendo audio:', error);
            setPlayingMessageId(null);
        }
    }, [playingMessageId, stopAudio]);

    const inputDisabled = isUploading || isSending || loading;
    const actionIcon = useMemo(() => {
        if (isUploading || isSending) return 'hourglass';
        if (messageText.trim()) return 'send';
        if (recording) return 'stop';
        return 'mic';
    }, [isUploading, isSending, messageText, recording]);

    const openMessageProfile = useCallback(
        (userId: string) => {
            router.push({ pathname: '/user-profile/[id]', params: { id: userId } });
        },
        [router],
    );

    const onPickMessageReaction = useCallback(
        (messageId: string, emoji: string) => {
            if (!currentUserId) return;
            if (messageId.startsWith('local-')) return;
            void applyMessageReaction({
                messageId,
                userId: currentUserId,
                emoji,
                reactions,
                setReactions,
            });
        },
        [currentUserId, reactions, setReactions],
    );

    const renderItem = useCallback(
        ({ item }: { item: Message }) => (
            <ChatMessageRow
                item={item}
                currentUserId={currentUserId}
                isPlaying={playingMessageId === item.id}
                audioDurationSec={audioDurations[item.id]}
                reactions={reactions}
                videoLabel={t('chat.videoLabel')}
                onOpenProfile={openMessageProfile}
                onOpenImage={setModalImage}
                onOpenVideo={setModalVideo}
                onPlayAudio={playAudio}
                onLongPressMessage={setReactionPickerId}
                onReplyMessage={(messageId) => {
                    const msg = messagesRef.current.find((m) => m.id === messageId);
                    if (!msg) return;
                    const name = Array.isArray(msg.perfiles)
                        ? msg.perfiles[0]?.nombre
                        : msg.perfiles?.nombre;
                    setReplyTo({
                        id: msg.id,
                        name: name || otherUserName || 'Usuario',
                        preview: previewForReply(msg.contenido, msg.tipo),
                    });
                }}
                onPickReaction={onPickMessageReaction}
            />
        ),
        [
            currentUserId,
            playingMessageId,
            audioDurations,
            reactions,
            t,
            openMessageProfile,
            playAudio,
            onPickMessageReaction,
            otherUserName,
        ],
    );

    const renderListFooter = () => {
        if (!loadingMore) return null;
        return (
            <View style={styles.loadMore}>
                <ActivityIndicator color={PRIMARY} size="small" />
            </View>
        );
    };

    const handleDeleteDirectChat = useCallback(() => {
        if (!currentUserId || !otherUserId) return;
        Alert.alert(t('chat.deleteDirectTitle'), t('chat.deleteDirectConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('chat.deleteChat'),
                style: 'destructive',
                onPress: async () => {
                    const { error } = await hideDirectChat(currentUserId, otherUserId);
                    if (error) {
                        Alert.alert(t('profile.error'), error);
                        return;
                    }
                    const cacheKey = directChatKey(currentUserId, otherUserId);
                    cacheInvalidate(cacheKey);
                    router.back();
                },
            },
        ]);
    }, [currentUserId, otherUserId, t, router]);

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={PRIMARY} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.headerIdentity}
                    activeOpacity={0.85}
                    onPress={() =>
                        router.push({ pathname: '/user-profile/[id]', params: { id: otherUserId } })
                    }
                >
                    <Image
                        source={{ uri: otherUserAvatar || 'https://via.placeholder.com/150' }}
                        style={styles.planHeaderImage}
                    />

                    <View style={styles.headerTitleContainer}>
                        <Text style={styles.headerTitle} numberOfLines={1}>
                            {otherUserName}
                        </Text>
                        <Text style={styles.headerSubtitle} numberOfLines={1}>
                            {t('chat.directSubtitle')}
                        </Text>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleDeleteDirectChat} style={styles.menuBtn} hitSlop={8}>
                    <Ionicons name="trash-outline" size={22} color={DANGER} />
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
            >
                {loading ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={PRIMARY} size="large" />
                    </View>
                ) : (
                    <View style={{ flex: 1 }}>
                        <FlashList
                            style={{ flex: 1 }}
                            data={messages}
                            keyExtractor={(item) => item.id}
                            renderItem={renderItem}
                            getItemType={chatMessageItemType}
                            inverted
                            drawDistance={FLASH_LIST_DRAW_DISTANCE}
                            contentContainerStyle={styles.listContent}
                            keyboardShouldPersistTaps="handled"
                            onEndReached={loadMoreMessages}
                            onEndReachedThreshold={0.3}
                            ListFooterComponent={renderListFooter}
                        />
                        {messages.length === 0 ? (
                            <View style={styles.emptyChatOverlay} pointerEvents="none">
                                <Text style={styles.emptyChatText}>{t('chat.emptyThread')}</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                {typingNames.length > 0 ? (
                    <Text style={styles.typingHint}>
                        {typingNames.length === 1
                            ? t('chat.typingOne', { name: typingNames[0] })
                            : t('chat.typingMany', { names: typingNames.join(', ') })}
                    </Text>
                ) : null}

                {replyTo ? (
                    <View style={styles.replyChip}>
                        <View style={styles.replyChipBody}>
                            <Text style={styles.replyChipName} numberOfLines={1}>
                                {t('chat.replyingTo', { name: replyTo.name })}
                            </Text>
                            <Text style={styles.replyChipPreview} numberOfLines={1}>
                                {replyTo.preview}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
                            <Ionicons name="close" size={20} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>
                ) : null}

                <View style={[styles.inputBar, { paddingBottom: Platform.OS === 'android' ? 8 : Math.max(insets.bottom, 8) }]}>
                    <TouchableOpacity
                        onPress={pickMedia}
                        style={styles.attachBtn}
                        disabled={inputDisabled}
                    >
                        <Ionicons
                            name="add"
                            size={26}
                            color={inputDisabled ? '#CBD5E1' : theme.colors.textMuted}
                        />
                    </TouchableOpacity>

                    <View style={styles.inputContainer}>
                        <TextInput
                            testID="direct-chat-message-input"
                            placeholder={
                                recording
                                    ? `${t('chat.recording')} ${formatDuration(recordingDuration)}...`
                                    : t('chat.writeMessage')
                            }
                            placeholderTextColor={theme.colors.textMuted}
                            style={styles.textInput}
                            value={messageText}
                            onChangeText={onMessageTextChange}
                            multiline
                            editable={!recording && !inputDisabled}
                        />
                    </View>

                    <TouchableOpacity
                        testID="direct-chat-send"
                        accessibilityLabel="Enviar mensaje"
                        onPress={handleActionPress}
                        style={[
                            styles.sendCircle,
                            recording && styles.recordingActive,
                            inputDisabled && styles.sendCircleDisabled,
                        ]}
                        disabled={inputDisabled && !recording}
                    >
                        <Ionicons name={actionIcon} size={18} color="white" />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            <ReactionEmojiPicker
                visible={!!reactionPickerId}
                onClose={() => setReactionPickerId(null)}
                reportLabel={t('report.messageAction')}
                onReport={
                    reactionPickerId
                    && !reactionPickerId.startsWith('local-')
                    && messages.find((message) => message.id === reactionPickerId)?.emisor_id !== currentUserId
                        ? () => {
                              const messageId = reactionPickerId;
                              setReactionPickerId(null);
                              router.push({ pathname: '/report-message', params: { messageId } });
                          }
                        : undefined
                }
                onPick={(emoji) => {
                    const mid = reactionPickerId;
                    setReactionPickerId(null);
                    if (!mid || !currentUserId || mid.startsWith('local-')) return;
                    void applyMessageReaction({
                        messageId: mid,
                        userId: currentUserId,
                        emoji,
                        reactions,
                        setReactions,
                    });
                }}
            />

            <Modal
                visible={modalImage !== null}
                transparent
                animationType="fade"
                onRequestClose={() => setModalImage(null)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setModalImage(null)}
                >
                    <Image
                        source={{ uri: modalImage || '' }}
                        style={styles.modalImage}
                        resizeMode="contain"
                    />
                    <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalImage(null)}>
                        <Ionicons name="close" size={32} color={theme.colors.surface} />
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <Modal
                visible={modalVideo !== null}
                animationType="slide"
                onRequestClose={() => setModalVideo(null)}
            >
                <View style={styles.videoModal}>
                    <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVideo(null)}>
                        <Ionicons name="close" size={32} color={theme.colors.surface} />
                    </TouchableOpacity>
                    {modalVideo && (
                        <Video
                            source={{ uri: modalVideo }}
                            style={styles.fullVideo}
                            useNativeControls
                            shouldPlay
                            resizeMode={ResizeMode.CONTAIN}
                        />
                    )}
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F2F2' },
    header: {
        minHeight: 56,
        backgroundColor: theme.colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#EEE',
    },
    backBtn: { padding: 5 },
    headerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
    menuBtn: { padding: 8, marginLeft: 4 },
    planHeaderImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginLeft: 5,
        backgroundColor: theme.colors.surfaceSubtle,
    },
    headerTitleContainer: { marginLeft: 10, flex: 1, minWidth: 0 },
    headerTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
    headerSubtitle: { fontSize: 12, color: theme.colors.textMuted },
    loading: { flex: 1, justifyContent: 'center' },
    emptyChatOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    emptyChatText: { color: theme.colors.textSubtle, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    loadMore: { paddingVertical: 16, alignItems: 'center' },
    listContent: { paddingHorizontal: 10, paddingVertical: 20, flexGrow: 1 },
    msgContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    myMsgContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
        justifyContent: 'flex-end',
    },
    otherMsgContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    avatarWrap: { marginRight: 8 },
    avatarWrapMe: { marginLeft: 8 },
    miniAvatar: { width: 32, height: 32, borderRadius: 16 },
    bubbleCol: { maxWidth: '78%', flexShrink: 1 },
    bubble: {
        maxWidth: '100%',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 18,
    },
    myBubble: {
        backgroundColor: PRIMARY,
        borderBottomRightRadius: 4,
    },
    otherBubble: {
        backgroundColor: theme.colors.surface,
        borderBottomLeftRadius: 4,
    },
    senderName: { fontSize: 11, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 2 },
    msgText: { fontSize: 15, color: theme.colors.text, lineHeight: 20 },
    myMsgText: { color: theme.colors.surface },
    otherMsgText: { color: theme.colors.text },
    timeText: { fontSize: 10, marginTop: 4 },
    myTime: { color: 'rgba(255,255,255,0.8)', textAlign: 'right' },
    otherTime: { color: theme.colors.textSubtle },
    mediaImage: { width: 200, height: 200, borderRadius: 12 },
    videoContainer: { width: 200, height: 150, borderRadius: 12, overflow: 'hidden' },
    videoPlaceholder: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoLabel: { color: theme.colors.surface, marginTop: 8, fontWeight: '600' },
    audioContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        minWidth: 120,
    },
    audioInfo: { marginLeft: 8 },
    audioText: { fontSize: 13, fontWeight: '600' },
    audioDuration: { fontSize: 11, marginTop: 2 },
    typingHint: {
        paddingHorizontal: 16,
        paddingBottom: 4,
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textMuted,
    },
    replyChip: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 12,
        marginBottom: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: theme.colors.primarySoft,
        borderLeftWidth: 3,
        borderLeftColor: PRIMARY,
        gap: 8,
    },
    replyChipBody: { flex: 1 },
    replyChipName: { fontSize: 12, fontWeight: '800', color: PRIMARY },
    replyChipPreview: { fontSize: 13, color: theme.colors.textMuted, marginTop: 1 },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: '#EEE',
    },
    attachBtn: { padding: 8, marginRight: 4, marginBottom: 2 },
    inputContainer: {
        flex: 1,
        marginRight: 8,
        backgroundColor: theme.colors.surfaceSubtle,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        minHeight: 44,
        maxHeight: 86,
        justifyContent: 'center',
    },
    textInput: {
        fontSize: 16,
        lineHeight: 22,
        color: theme.colors.text,
        maxHeight: 66,
        padding: 0,
        textAlignVertical: 'top',
    },
    sendCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: PRIMARY,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 2,
    },
    recordingActive: { backgroundColor: DANGER },
    sendCircleDisabled: { backgroundColor: '#CBD5E1' },
    uploadBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: '#EEE',
    },
    uploadBannerText: { marginLeft: 8, fontSize: 13, color: theme.colors.textMuted },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.9)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalImage: { width: '100%', height: '100%' },
    modalCloseBtn: {
        position: 'absolute',
        top: 40,
        right: 20,
        backgroundColor: 'rgba(0,0,0,0.5)',
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoModal: { flex: 1, backgroundColor: '#000' },
    fullVideo: { flex: 1 },
});
