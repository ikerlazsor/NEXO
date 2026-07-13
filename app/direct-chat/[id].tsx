import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { uploadChatFile } from '../../lib/chatUpload';
import { useT } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';

const PRIMARY = '#4DA6FF';
const DANGER = '#EF4444';
const PAGE_SIZE = 50;

interface MessageProfile {
    nombre: string;
    avatar_url: string | null;
}

interface Message {
    id: string;
    texto: string;
    usuario_id: string;
    created_at: string;
    tipo: 'texto' | 'imagen' | 'video' | 'audio';
    archivo_url: string | null;
    perfiles: MessageProfile | MessageProfile[] | null;
}

function normalizeProfile(
    perfiles: Message['perfiles']
): MessageProfile | null {
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

function parseStoredDuration(texto: string): number | null {
    if (!texto || !/^\d+$/.test(texto.trim())) return null;
    const value = parseInt(texto, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function mapMessageRow(row: Record<string, unknown>): Message {
    return {
        id: row.id as string,
        texto: (row.texto as string) ?? '',
        usuario_id: row.usuario_id as string,
        created_at: row.created_at as string,
        tipo: (row.tipo as Message['tipo']) ?? 'texto',
        archivo_url: (row.archivo_url as string | null) ?? null,
        perfiles: row.perfiles as Message['perfiles'],
    };
}

export default function DirectChatScreen() {
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const otherUserId = Array.isArray(id) ? id[0] : id;
    const router = useRouter();
    const { t } = useT();
    const headerHeight = useHeaderHeight();
    const insets = useSafeAreaInsets();

    const [otherUserName, setOtherUserName] = useState('Cargando...');
    const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null);
    const [messageText, setMessageText] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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
                .from('mensajes_directos')
                .select(`
                    id,
                    texto,
                    usuario_id,
                    created_at,
                    tipo,
                    archivo_url,
                    perfiles:usuario_id (
                        nombre,
                        avatar_url
                    )
                `)
                .or(`and(usuario_id.eq.${user.id},receptor_id.eq.${otherUserId}),and(usuario_id.eq.${otherUserId},receptor_id.eq.${user.id})`)
                .order('created_at', { ascending: false })
                .limit(PAGE_SIZE);

            if (before) {
                query = query.lt('created_at', before);
            }

            const { data, error } = await query;
            if (error) throw error;

            const rows = (data ?? []).map((row) => mapMessageRow(row as Record<string, unknown>));
            return rows;
        },
        [otherUserId]
    );

    const loadMoreMessages = useCallback(async () => {
        if (!otherUserId || loadingMore || !hasMore || messages.length === 0) return;

        setLoadingMore(true);
        try {
            const oldest = messages[messages.length - 1];
            const older = await fetchMessages(oldest.created_at);

            if (older.length < PAGE_SIZE) setHasMore(false);

            setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const unique = older.filter((m) => !existingIds.has(m.id));
                return [...prev, ...unique];
            });
        } catch (error) {
            console.error('Error cargando más mensajes:', error);
        } finally {
            setLoadingMore(false);
        }
    }, [otherUserId, loadingMore, hasMore, messages, fetchMessages]);

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
            const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: false });
            const status = await sound.getStatusAsync();
            await sound.unloadAsync();

            if (status.isLoaded && status.durationMillis) {
                const seconds = Math.max(1, Math.round(status.durationMillis / 1000));
                setAudioDurations((prev) => ({ ...prev, [messageId]: seconds }));
            }
        } catch (error) {
            console.error('Error obteniendo duración de audio:', error);
        } finally {
            loadingDurationsRef.current.delete(messageId);
        }
    }, []);

    useEffect(() => {
        messages.forEach((message) => {
            if (message.tipo !== 'audio' || !message.archivo_url) return;
            if (parseStoredDuration(message.texto)) return;
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
            setLoading(true);
            setHasMore(true);

            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!isMountedRef.current) return;

                if (!user) {
                    router.replace('/login');
                    return;
                }

                setCurrentUserId(user.id);

                const { data: otherProfile } = await supabase
                    .from('perfiles')
                    .select('nombre, avatar_url')
                    .eq('id', otherUserId)
                    .single();

                if (otherProfile) {
                    setOtherUserName(otherProfile.nombre);
                    setOtherUserAvatar(otherProfile.avatar_url);
                }

                const initialMessages = await fetchMessages();

                if (!isMountedRef.current) return;

                setMessages(initialMessages);
                setHasMore(initialMessages.length >= PAGE_SIZE);

                channel = supabase
                    .channel(`direct-chat:${user.id}:${otherUserId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'INSERT',
                            schema: 'public',
                            table: 'mensajes_directos',
                            filter: `or(and(usuario_id=eq.${user.id},receptor_id=eq.${otherUserId}),and(usuario_id=eq.${otherUserId},receptor_id=eq.${user.id}))`,
                        },
                        async (payload) => {
                            const newId = payload.new.id as string;

                            const { data: perfil } = await supabase
                                .from('perfiles')
                                .select('nombre, avatar_url')
                                .eq('id', payload.new.usuario_id)
                                .single();

                            const newMessage: Message = {
                                id: newId,
                                texto: (payload.new.texto as string) ?? '',
                                usuario_id: payload.new.usuario_id as string,
                                created_at: payload.new.created_at as string,
                                tipo: (payload.new.tipo as Message['tipo']) ?? 'texto',
                                archivo_url: (payload.new.archivo_url as string | null) ?? null,
                                perfiles: perfil,
                            };

                            if (isMountedRef.current) {
                                setMessages((prev) => {
                                    if (prev.some((m) => m.id === newMessage.id)) return prev;
                                    return [newMessage, ...prev];
                                });
                            }
                        }
                    )
                    .subscribe();
            } catch (error) {
                console.error('Error en initChat:', error);
                Alert.alert(t('chat.errorTitle'), t('chat.loadError'));
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        };

        initChat();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [otherUserId, router, fetchMessages]);

    const sendMessage = async (
        tipo: 'texto' | 'imagen' | 'video' | 'audio' = 'texto',
        archivoUrl: string | null = null,
        audioDurationSec?: number
    ) => {
        if (!currentUserId || !otherUserId) return;

        const tempText = messageText.trim();
        if (tipo === 'texto' && !tempText) return;

        if (tipo === 'texto') setMessageText('');
        setIsSending(true);

        const textoPayload =
            tipo === 'texto'
                ? tempText
                : tipo === 'audio' && audioDurationSec
                  ? String(audioDurationSec)
                  : '';

        const { error } = await supabase.from('mensajes_directos').insert({
            usuario_id: currentUserId,
            receptor_id: otherUserId,
            texto: textoPayload,
            tipo,
            archivo_url: archivoUrl,
        });

        setIsSending(false);

        if (error) {
            Alert.alert(t('chat.errorTitle'), t('chat.sendError'));
            if (tipo === 'texto') setMessageText(tempText);
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
            await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

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

    const playAudio = async (messageId: string, audioUrl: string) => {
        try {
            if (playingMessageId === messageId) {
                await stopAudio();
                return;
            }

            await stopAudio();

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
            console.error('Error reproduciendo audio:', error);
            Alert.alert(t('chat.errorTitle'), t('chat.audioError'));
            setPlayingMessageId(null);
        }
    };

    const inputDisabled = isUploading || isSending || loading;
    const actionIcon = useMemo(() => {
        if (isUploading || isSending) return 'hourglass';
        if (messageText.trim()) return 'send';
        if (recording) return 'stop';
        return 'mic';
    }, [isUploading, isSending, messageText, recording]);

    const renderItem = ({ item }: { item: Message }) => {
        const isMe = item.usuario_id === currentUserId;
        const profile = normalizeProfile(item.perfiles);
        const nombreMostrar = profile?.nombre || 'Usuario';
        const avatarUri = profile?.avatar_url
            ? profile.avatar_url
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(nombreMostrar)}&background=4DA6FF&color=fff`;
        const isThisPlaying = playingMessageId === item.id;

        const renderContent = () => {
            if (item.tipo === 'imagen' && item.archivo_url) {
                return (
                    <TouchableOpacity onPress={() => setModalImage(item.archivo_url)}>
                        <Image
                            source={{ uri: item.archivo_url }}
                            style={styles.mediaImage}
                            resizeMode="cover"
                        />
                    </TouchableOpacity>
                );
            }

            if (item.tipo === 'video' && item.archivo_url) {
                return (
                    <TouchableOpacity
                        style={styles.videoContainer}
                        onPress={() => setModalVideo(item.archivo_url)}
                    >
                        <View style={styles.videoPlaceholder}>
                            <Ionicons name="play-circle" size={48} color="#FFF" />
                            <Text style={styles.videoLabel}>{t('chat.videoLabel')}</Text>
                        </View>
                    </TouchableOpacity>
                );
            }

            if (item.tipo === 'audio' && item.archivo_url) {
                const storedDuration = parseStoredDuration(item.texto);
                const durationSec = storedDuration ?? audioDurations[item.id];
                const durationLabel = durationSec ? formatDuration(durationSec) : '--:--';

                return (
                    <TouchableOpacity
                        style={styles.audioContainer}
                        onPress={() => playAudio(item.id, item.archivo_url!)}
                    >
                        <Ionicons
                            name={isThisPlaying ? 'pause' : 'play'}
                            size={20}
                            color={isMe ? '#FFF' : PRIMARY}
                        />
                        <View style={styles.audioInfo}>
                            <Text style={[styles.audioText, isMe ? styles.myMsgText : styles.otherMsgText]}>
                                {isThisPlaying ? 'Reproduciendo' : 'Nota de voz'}
                            </Text>
                            <Text style={[styles.audioDuration, isMe ? styles.myTime : styles.otherTime]}>
                                {durationLabel}
                            </Text>
                        </View>
                    </TouchableOpacity>
                );
            }

            return (
                <Text style={[styles.msgText, isMe ? styles.myMsgText : styles.otherMsgText]}>
                    {item.texto}
                </Text>
            );
        };

        return (
            <View style={[styles.msgContainer, isMe ? styles.myMsgContainer : styles.otherMsgContainer]}>
                {!isMe && (
                    <TouchableOpacity
                        style={styles.avatarWrap}
                        onPress={() =>
                            router.push({
                                pathname: '/user-profile/[id]',
                                params: { id: item.usuario_id },
                            })
                        }
                    >
                        <Image source={{ uri: avatarUri }} style={styles.miniAvatar} />
                    </TouchableOpacity>
                )}
                <View style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble]}>
                    {!isMe && <Text style={styles.senderName}>{nombreMostrar}</Text>}
                    {renderContent()}
                    <Text style={[styles.timeText, isMe ? styles.myTime : styles.otherTime]}>
                        {new Date(item.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </Text>
                </View>
                {isMe && (
                    <View style={styles.avatarWrapMe}>
                        <Image source={{ uri: avatarUri }} style={styles.miniAvatar} />
                    </View>
                )}
            </View>
        );
    };

    const renderListFooter = () => {
        if (!loadingMore) return null;
        return (
            <View style={styles.loadMore}>
                <ActivityIndicator color={PRIMARY} size="small" />
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={PRIMARY} />
                </TouchableOpacity>

                <Image
                    source={{ uri: otherUserAvatar || 'https://via.placeholder.com/150' }}
                    style={styles.planHeaderImage}
                />

                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {otherUserName}
                    </Text>
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                        Mensaje directo
                    </Text>
                </View>
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={headerHeight}
            >
                {loading ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={PRIMARY} size="large" />
                    </View>
                ) : (
                    <FlatList
                        data={messages}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        inverted
                        contentContainerStyle={styles.listContent}
                        keyboardShouldPersistTaps="handled"
                        onEndReached={loadMoreMessages}
                        onEndReachedThreshold={0.3}
                        ListFooterComponent={renderListFooter}
                        ListEmptyComponent={
                            <View style={styles.emptyChat}>
                                <Text style={styles.emptyChatText}>
                                    No hay mensajes aún. ¡Sé el primero en escribir!
                                </Text>
                            </View>
                        }
                    />
                )}

                {isUploading && (
                    <View style={styles.uploadBanner}>
                        <ActivityIndicator color={PRIMARY} size="small" />
                        <Text style={styles.uploadBannerText}>{t('chat.uploading')}</Text>
                    </View>
                )}

                <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                    <TouchableOpacity
                        onPress={pickMedia}
                        style={styles.attachBtn}
                        disabled={inputDisabled}
                    >
                        <Ionicons
                            name="add"
                            size={26}
                            color={inputDisabled ? '#CBD5E1' : '#64748B'}
                        />
                    </TouchableOpacity>

                    <View style={styles.inputContainer}>
                        <TextInput
                            placeholder={
                                recording
                                    ? `${t('chat.recording')} ${formatDuration(recordingDuration)}...`
                                    : t('chat.writeMessage')
                            }
                            placeholderTextColor="#64748B"
                            style={styles.textInput}
                            value={messageText}
                            onChangeText={setMessageText}
                            multiline
                            editable={!recording && !inputDisabled}
                        />
                    </View>

                    <TouchableOpacity
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
                        <Ionicons name="close" size={32} color="#FFF" />
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
                        <Ionicons name="close" size={32} color="#FFF" />
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
        backgroundColor: '#FFF',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#EEE',
    },
    backBtn: { padding: 5 },
    planHeaderImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginLeft: 5,
        backgroundColor: '#F1F5F9',
    },
    headerTitleContainer: { marginLeft: 10, flex: 1 },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#1E293B' },
    headerSubtitle: { fontSize: 12, color: '#64748B' },
    loading: { flex: 1, justifyContent: 'center' },
    emptyChat: { padding: 40, alignItems: 'center', transform: [{ scaleY: -1 }] },
    emptyChatText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
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
    bubble: {
        maxWidth: '70%',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 18,
    },
    myBubble: {
        backgroundColor: PRIMARY,
        borderBottomRightRadius: 4,
    },
    otherBubble: {
        backgroundColor: '#FFF',
        borderBottomLeftRadius: 4,
    },
    senderName: { fontSize: 11, fontWeight: '700', color: '#64748B', marginBottom: 2 },
    msgText: { fontSize: 15, color: '#1E293B', lineHeight: 20 },
    myMsgText: { color: '#FFF' },
    otherMsgText: { color: '#1E293B' },
    timeText: { fontSize: 10, marginTop: 4 },
    myTime: { color: 'rgba(255,255,255,0.8)', textAlign: 'right' },
    otherTime: { color: '#94A3B8' },
    mediaImage: { width: 200, height: 200, borderRadius: 12 },
    videoContainer: { width: 200, height: 150, borderRadius: 12, overflow: 'hidden' },
    videoPlaceholder: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoLabel: { color: '#FFF', marginTop: 8, fontWeight: '600' },
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
    inputBar: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#EEE',
    },
    attachBtn: { padding: 8, marginRight: 8 },
    inputContainer: { flex: 1, marginRight: 8 },
    textInput: {
        fontSize: 16,
        color: '#1E293B',
        maxHeight: 100,
        paddingVertical: 8,
    },
    sendCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: PRIMARY,
        justifyContent: 'center',
        alignItems: 'center',
    },
    recordingActive: { backgroundColor: DANGER },
    sendCircleDisabled: { backgroundColor: '#CBD5E1' },
    uploadBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#EEE',
    },
    uploadBannerText: { marginLeft: 8, fontSize: 13, color: '#64748B' },
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
