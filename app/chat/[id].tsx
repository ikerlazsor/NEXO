import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import React from 'react';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
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
import { PlanImage } from '../../components/PlanImage';
import { uploadChatFile } from '../../lib/chatUpload';
import { markPlanChatRead } from '../../lib/chatUnread';
import { getAvatarUri, getFriends, type FriendProfile } from '../../lib/friends';
import { kickParticipant } from '../../lib/kickParticipant';
import { isUserCreatedGroupChat, updateGroupChatPhoto, uploadGroupChatPhoto } from '../../lib/groupChat';
import { useT } from '../../lib/i18n';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { sendPlanInvite } from '../../lib/planInvites';
import {
    formatCountdown,
    getChatExpiryMs,
    isGroupOrChatPlan,
    isPlanChatAlive,
    runPlanLifecycleMaintenance,
} from '../../lib/planLifecycle';
import { resolvePlanImageSource } from '../../lib/sports';
import { supabase } from '../../lib/supabase';

const PRIMARY = '#4DA6FF';
const PAGE_SIZE = 50;

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

export default function ChatScreen() {
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const planId = Array.isArray(id) ? id[0] : id;
    const router = useRouter();
    const { t } = useT();
    const headerHeight = useHeaderHeight();
    const insets = useSafeAreaInsets();

    const [planName, setPlanName] = useState('');
    const [planImage, setPlanImage] = useState<string | null>(null);
    const [participantNames, setParticipantNames] = useState('');
    const [isGroupChat, setIsGroupChat] = useState(false);
    const [planCategory, setPlanCategory] = useState<string | null>(null);
    const [planOwnerId, setPlanOwnerId] = useState<string | null>(null);
    const [uploadingGroupPhoto, setUploadingGroupPhoto] = useState(false);
    const [members, setMembers] = useState<{ id: string; nombre: string; avatar_url: string | null; isCreator: boolean }[]>([]);
    const [showInviteFriends, setShowInviteFriends] = useState(false);
    const [inviteFriends, setInviteFriends] = useState<(FriendProfile & { friendshipId: string })[]>([]);
    const [loadingInviteFriends, setLoadingInviteFriends] = useState(false);
    const [invitingFriendId, setInvitingFriendId] = useState<string | null>(null);
    const [creatorId, setCreatorId] = useState<string | null>(null);
    const [showMembers, setShowMembers] = useState(false);
    const [messageText, setMessageText] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [accessDenied, setAccessDenied] = useState(false);
    const [planFechaEvento, setPlanFechaEvento] = useState<string | null>(null);
    const [chatExpiryLabel, setChatExpiryLabel] = useState<string | null>(null);

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

    const fetchParticipants = useCallback(async (pid: string) => {
        const { data: planData } = await supabase
            .from('planes')
            .select('creador_id, perfiles:creador_id(nombre, avatar_url)')
            .eq('id', pid)
            .single();

        const { data: parts } = await supabase
            .from('participantes')
            .select('usuario_id, estado, perfiles:usuario_id(nombre, avatar_url)')
            .eq('plan_id', pid);

        const ownerId = (planData?.creador_id as string) ?? null;
        setCreatorId(ownerId);

        const byId = new Map<string, { id: string; nombre: string; avatar_url: string | null; isCreator: boolean }>();

        const creator = normalizeProfile(planData?.perfiles as Message['perfiles']);
        if (ownerId) {
            byId.set(ownerId, {
                id: ownerId,
                nombre: creator?.nombre || t('chat.host'),
                avatar_url: creator?.avatar_url ?? null,
                isCreator: true,
            });
        }

        (parts ?? []).forEach((p: any) => {
            if (p.estado !== 'aceptado') return;
            const uid = p.usuario_id as string;
            if (!uid || byId.has(uid)) return;
            const profile = normalizeProfile(p.perfiles as Message['perfiles']);
            byId.set(uid, {
                id: uid,
                nombre: profile?.nombre || t('profile.user'),
                avatar_url: profile?.avatar_url ?? null,
                isCreator: uid === ownerId,
            });
        });

        const list = Array.from(byId.values());
        setMembers(list);

        if (list.length === 0) {
            setParticipantNames(t('chat.noParticipants'));
        } else {
            setParticipantNames(list.map((m) => m.nombre).join(', '));
        }
    }, [t]);

    const openInviteFriends = useCallback(async () => {
        if (!currentUserId) return;
        setShowInviteFriends(true);
        setLoadingInviteFriends(true);
        try {
            const list = await getFriends(currentUserId);
            const memberIds = new Set(members.map((m) => m.id));
            setInviteFriends(list.filter((f) => !memberIds.has(f.id)));
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingInviteFriends(false);
        }
    }, [currentUserId, members]);

    const handleInviteFriend = useCallback(
        async (friendId: string) => {
            if (!planId || !currentUserId) return;
            setInvitingFriendId(friendId);
            const tipo = isGroupChat ? 'grupo' : 'plan';
            const { error } = await sendPlanInvite(planId, currentUserId, friendId, tipo);
            setInvitingFriendId(null);
            if (error === 'already_member' || error === 'already_invited') {
                Alert.alert(t('login.notice'), t('friends.inviteAlready'));
                return;
            }
            if (error) {
                Alert.alert(t('profile.error'), error.includes('plan_invitaciones') ? t('friends.invitesSqlHint') : t('chat.inviteError'));
                return;
            }
            Alert.alert(t('login.notice'), t('chat.inviteSent'));
        },
        [planId, currentUserId, isGroupChat, t]
    );

    const isCreatedGroupChat = isUserCreatedGroupChat({ categoria: planCategory });

    const canEditGroupPhoto =
        !!planId &&
        !!currentUserId &&
        !accessDenied &&
        isCreatedGroupChat &&
        !!planOwnerId &&
        planOwnerId === currentUserId;

    const handleGroupPhotoPicked = useCallback(
        async (uri: string) => {
            if (!planId) return;
            setUploadingGroupPhoto(true);
            const url = await uploadGroupChatPhoto(planId, uri);
            if (!url) {
                Alert.alert(t('profile.error'), t('chat.groupPhotoError'));
                setUploadingGroupPhoto(false);
                return;
            }
            const { error } = await updateGroupChatPhoto(planId, url);
            setUploadingGroupPhoto(false);
            if (error) {
                Alert.alert(
                    t('profile.error'),
                    error === 'rls_planes_update'
                        ? t('chat.groupPhotoRlsHint')
                        : error
                );
                return;
            }
            setPlanImage(url);
        },
        [planId, t]
    );

    const showGroupPhotoMenu = useCallback(() => {
        if (!canEditGroupPhoto || uploadingGroupPhoto) return;
        Alert.alert(t('chat.groupPhotoTitle'), t('chat.groupPhotoChoice'), [
            { text: t('profile.camera'), onPress: async () => {
                const result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ['images'],
                    allowsEditing: true,
                    aspect: [1, 1],
                    quality: 0.5,
                });
                if (!result.canceled && result.assets[0]?.uri) handleGroupPhotoPicked(result.assets[0].uri);
            }},
            { text: t('profile.gallery'), onPress: async () => {
                const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    allowsEditing: true,
                    aspect: [1, 1],
                    quality: 0.5,
                });
                if (!result.canceled && result.assets[0]?.uri) handleGroupPhotoPicked(result.assets[0].uri);
            }},
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    }, [canEditGroupPhoto, uploadingGroupPhoto, handleGroupPhotoPicked, t]);

    const handleDeleteChat = useCallback(() => {
        if (!planId || !currentUserId) return;
        const isHost = creatorId === currentUserId;
        const title = isHost ? t('chat.deletePlanHost') : t('chat.deleteChat');
        const message = isHost ? t('chat.deletePlanHostConfirm') : t('chat.deleteChatConfirm');
        const actionLabel = isHost ? t('chat.deletePlanHost') : t('chat.deleteChat');

        Alert.alert(title, message, [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: actionLabel,
                style: 'destructive',
                onPress: async () => {
                    if (isHost) {
                        const { error } = await deletePlanCompletely(planId);
                        if (error) {
                            Alert.alert(t('profile.error'), t('chat.deletePlanError') + ': ' + error);
                            return;
                        }
                    } else {
                        const { error } = await supabase
                            .from('participantes')
                            .delete()
                            .eq('plan_id', planId)
                            .eq('usuario_id', currentUserId);
                        if (error) {
                            Alert.alert(t('profile.error'), error.message);
                            return;
                        }
                    }
                    setShowMembers(false);
                    router.back();
                },
            },
        ]);
    }, [planId, currentUserId, creatorId, t, router]);

    const fetchMessages = useCallback(
        async (pid: string, before?: string) => {
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
                .eq('plan_id', pid)
                .order('creado_en', { ascending: false })
                .limit(PAGE_SIZE);

            if (before) {
                query = query.lt('creado_en', before);
            }

            const { data, error } = await query;
            if (error) throw error;

            const rows = (data ?? []).map((row) => mapMessageRow(row as Record<string, unknown>));
            return rows;
        },
        []
    );

    const loadMoreMessages = useCallback(async () => {
        if (!planId || loadingMore || !hasMore || messages.length === 0) return;

        setLoadingMore(true);
        try {
            const oldest = messages[messages.length - 1];
            const older = await fetchMessages(planId, oldest.creado_en);

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
    }, [planId, loadingMore, hasMore, messages, fetchMessages]);

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
        if (!planId) return;

        let channel: ReturnType<typeof supabase.channel> | null = null;

        const initChat = async () => {
            setLoading(true);
            setAccessDenied(false);
            setHasMore(true);

            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!isMountedRef.current) return;

                if (!user) {
                    router.replace('/login');
                    return;
                }

                setCurrentUserId(user.id);

                void runPlanLifecycleMaintenance();

                const { data: planData, error: planError } = await supabase
                    .from('planes')
                    .select('titulo, imagen_url, creador_id, categoria, fecha_evento, chat_eliminado_en')
                    .eq('id', planId)
                    .single();

                if (planError || !planData) {
                    Alert.alert(t('chat.errorTitle'), t('chat.planNotFound'));
                    router.back();
                    return;
                }

                if (!isPlanChatAlive(planData)) {
                    Alert.alert(t('chat.errorTitle'), t('chat.expired'));
                    router.back();
                    return;
                }

                setPlanFechaEvento(planData.fecha_evento ?? null);

                const { data: membership } = await supabase
                    .from('participantes')
                    .select('usuario_id, estado')
                    .eq('plan_id', planId)
                    .eq('usuario_id', user.id)
                    .maybeSingle();

                const isCreator = planData.creador_id === user.id;
                const canAccessChat = isCreator || membership?.estado === 'aceptado';
                if (!canAccessChat) {
                    setAccessDenied(true);
                    setPlanName(planData.titulo);
                    setPlanImage(planData.imagen_url);
                    return;
                }

                if (!isMountedRef.current) return;

                setPlanCategory(planData.categoria ?? null);
                setPlanOwnerId(planData.creador_id ?? null);
                setCreatorId(planData.creador_id ?? null);
                setIsGroupChat(planData.categoria === 'Grupo');

                setPlanName(planData.titulo);
                setPlanImage(planData.imagen_url ?? null);

                const [initialMessages] = await Promise.all([
                    fetchMessages(planId),
                    fetchParticipants(planId),
                ]);

                if (!isMountedRef.current) return;

                setMessages(initialMessages);
                setHasMore(initialMessages.length >= PAGE_SIZE);
                void markPlanChatRead(user.id, planId);

                channel = supabase
                    .channel(`chat:${planId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'INSERT',
                            schema: 'public',
                            table: 'mensajes',
                            filter: `plan_id=eq.${planId}`,
                        },
                        async (payload) => {
                            const newId = payload.new.id as string;

                            const { data: perfil } = await supabase
                                .from('perfiles')
                                .select('nombre, avatar_url')
                                .eq('id', payload.new.emisor_id)
                                .single();

                            const newMessage: Message = {
                                id: newId,
                                contenido: (payload.new.contenido as string) ?? '',
                                emisor_id: payload.new.emisor_id as string,
                                creado_en: payload.new.creado_en as string,
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
    }, [planId, router, fetchMessages, fetchParticipants, t]);

    const refreshChatHeader = useCallback(async () => {
        if (!planId || !currentUserId || accessDenied) return;
        const { data } = await supabase
            .from('planes')
            .select('titulo, imagen_url')
            .eq('id', planId)
            .single();
        if (data) {
            if (data.titulo) setPlanName(data.titulo);
            if (data.imagen_url) setPlanImage(data.imagen_url);
        }
    }, [planId, currentUserId, accessDenied]);

    useEffect(() => {
        if (!planFechaEvento || isGroupOrChatPlan({ categoria: planCategory })) {
            setChatExpiryLabel(null);
            return;
        }
        const end = new Date(planFechaEvento).getTime();
        if (!Number.isFinite(end) || Date.now() < end) {
            setChatExpiryLabel(null);
            return;
        }
        const tick = () => {
            const expiry = getChatExpiryMs(planFechaEvento);
            if (!expiry) {
                setChatExpiryLabel(null);
                return;
            }
            const remaining = expiry - Date.now();
            if (remaining <= 0) {
                setChatExpiryLabel('0:00');
                void runPlanLifecycleMaintenance();
                Alert.alert(t('chat.errorTitle'), t('chat.expired'));
                router.back();
                return;
            }
            setChatExpiryLabel(formatCountdown(remaining));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [planFechaEvento, planCategory, router, t]);

    useFocusEffect(
        useCallback(() => {
            refreshChatHeader();
            if (currentUserId && planId && !accessDenied) {
                void markPlanChatRead(currentUserId, planId);
            }
            return () => {
                if (currentUserId && planId) {
                    void markPlanChatRead(currentUserId, planId);
                }
            };
        }, [refreshChatHeader, currentUserId, planId, accessDenied])
    );

    const sendMessage = async (
        tipo: 'texto' | 'imagen' | 'video' | 'audio' = 'texto',
        archivoUrl: string | null = null,
        audioDurationSec?: number
    ) => {
        if (!currentUserId || !planId || accessDenied) return;

        const tempText = messageText.trim();
        if (tipo === 'texto' && !tempText) return;

        if (tipo === 'texto') setMessageText('');
        setIsSending(true);

        const contenidoPayload =
            tipo === 'texto'
                ? tempText
                : tipo === 'audio' && audioDurationSec
                  ? String(audioDurationSec)
                  : '';

        const { error } = await supabase.from('mensajes').insert({
            plan_id: planId,
            contenido: contenidoPayload,
            emisor_id: currentUserId,
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
        if (isUploading || accessDenied) return;

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

        if (result.canceled || !planId) return;

        const selectedAsset = result.assets[0];
        const fileType = selectedAsset.type === 'video' ? 'video' : 'image';
        const messageType = fileType === 'image' ? 'imagen' : 'video';

        setIsUploading(true);
        const uploadedUrl = await uploadChatFile(selectedAsset.uri, fileType, planId);
        setIsUploading(false);

        if (uploadedUrl) {
            await sendMessage(messageType, uploadedUrl);
        } else {
            Alert.alert(t('chat.errorTitle'), t('chat.uploadError'));
        }
    };

    const startRecording = async () => {
        if (isUploading || accessDenied) return;

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
        if (!recording || !planId) return;

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
            const uploadedUrl = await uploadChatFile(uri, 'audio', planId);
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

    const inputDisabled = isUploading || isSending || accessDenied || loading;
    const actionIcon = useMemo(() => {
        if (isUploading || isSending) return 'hourglass';
        if (messageText.trim()) return 'send';
        if (recording) return 'stop';
        return 'mic';
    }, [isUploading, isSending, messageText, recording]);

    const renderItem = ({ item }: { item: Message }) => {
        const isMe = item.emisor_id === currentUserId;
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
                const storedDuration = parseStoredDuration(item.contenido);
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
                    {item.contenido}
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
                                params: { id: item.emisor_id },
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
                        {new Date(item.creado_en).toLocaleTimeString([], {
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
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={PRIMARY} />
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={canEditGroupPhoto ? showGroupPhotoMenu : () => setShowMembers(true)}
                    activeOpacity={0.7}
                    disabled={uploadingGroupPhoto}
                    style={styles.planHeaderImageWrap}
                >
                    {isCreatedGroupChat ? (
                        <Image
                            source={{
                                uri: planImage || 'https://via.placeholder.com/150/4DA6FF/FFFFFF?text=G',
                            }}
                            style={styles.planHeaderImage}
                        />
                    ) : (
                        <PlanImage
                            source={resolvePlanImageSource(planImage)}
                            style={styles.planHeaderImage}
                            recyclingKey={planId}
                        />
                    )}
                    {canEditGroupPhoto && (
                        <View style={styles.groupPhotoBadge}>
                            {uploadingGroupPhoto ? (
                                <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                                <Ionicons name="camera" size={14} color="#FFF" />
                            )}
                        </View>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.headerTitleContainer}
                    activeOpacity={0.7}
                    onPress={() => setShowMembers(true)}
                >
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {planName || (loading ? t('chat.loading') : '')}
                    </Text>
                    {(participantNames || loading) ? (
                        <Text style={styles.headerSubtitle} numberOfLines={1}>
                            {participantNames || (loading ? t('chat.loading') : '')}
                        </Text>
                    ) : null}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShowMembers(true)} style={styles.membersBtn}>
                    <Ionicons name="people" size={22} color={PRIMARY} />
                </TouchableOpacity>
            </View>

            {chatExpiryLabel ? (
                <View style={styles.expiryBanner}>
                    <Ionicons name="time-outline" size={16} color="#B45309" />
                    <Text style={styles.expiryBannerText}>
                        {t('chat.expiresIn', { time: chatExpiryLabel })}
                    </Text>
                </View>
            ) : null}

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={headerHeight}
            >
                {loading ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={PRIMARY} size="large" />
                    </View>
                ) : accessDenied ? (
                    <View style={styles.accessDenied}>
                        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
                        <Text style={styles.accessDeniedTitle}>{t('chat.accessDenied')}</Text>
                        <Text style={styles.accessDeniedText}>
                            {t('chat.accessDeniedSub')}
                        </Text>
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
                                    : accessDenied
                                      ? t('chat.cannotWrite')
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

            <Modal
                visible={showMembers}
                transparent
                animationType="slide"
                onRequestClose={() => setShowMembers(false)}
            >
                <TouchableOpacity style={styles.membersOverlay} activeOpacity={1} onPress={() => setShowMembers(false)}>
                    <TouchableOpacity style={styles.membersSheet} activeOpacity={1}>
                        <View style={styles.membersHandle} />
                        <Text style={styles.membersTitle}>{t('chat.members')} · {members.length}</Text>

                        {canEditGroupPhoto && (
                            <TouchableOpacity
                                style={styles.changeGroupPhotoBtn}
                                onPress={() => {
                                    setShowMembers(false);
                                    showGroupPhotoMenu();
                                }}
                                disabled={uploadingGroupPhoto}
                            >
                                <Ionicons name="camera-outline" size={20} color={PRIMARY} />
                                <Text style={styles.changeGroupPhotoText}>{t('chat.groupPhotoTitle')}</Text>
                            </TouchableOpacity>
                        )}

                        <FlatList
                            data={members}
                            keyExtractor={(m) => m.id}
                            style={{ maxHeight: 360 }}
                            renderItem={({ item: m }) => (
                                <View style={styles.memberRowWrap}>
                                    <TouchableOpacity
                                        style={[styles.memberRow, { flex: 1 }]}
                                        onPress={() => {
                                            setShowMembers(false);
                                            router.push({ pathname: '/user-profile/[id]', params: { id: m.id } });
                                        }}
                                    >
                                        <Image
                                            source={{ uri: m.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.nombre)}&background=4DA6FF&color=fff` }}
                                            style={styles.memberAvatar}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.memberName}>{m.nombre}</Text>
                                            {m.isCreator && <Text style={styles.memberCreator}>{t('chat.host')}</Text>}
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                                    </TouchableOpacity>
                                    {creatorId === currentUserId && !m.isCreator && currentUserId && planId && (
                                        <TouchableOpacity
                                            style={styles.memberKickBtn}
                                            onPress={() => {
                                                Alert.alert(
                                                    t('planDetail.kickTitle'),
                                                    t('planDetail.kickMsg', { name: m.nombre }),
                                                    [
                                                        { text: t('common.cancel'), style: 'cancel' },
                                                        {
                                                            text: t('planDetail.kickConfirm'),
                                                            style: 'destructive',
                                                            onPress: async () => {
                                                                const { error } = await kickParticipant(planId, m.id, currentUserId);
                                                                if (error) Alert.alert(t('chat.errorTitle'), error);
                                                                else await fetchParticipants(planId);
                                                            },
                                                        },
                                                    ],
                                                );
                                            }}
                                        >
                                            <Ionicons name="person-remove" size={20} color="#EF4444" />
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        />

                        {!accessDenied && (
                            <TouchableOpacity
                                style={styles.inviteBtn}
                                onPress={() => {
                                    setShowMembers(false);
                                    openInviteFriends();
                                }}
                            >
                                <Ionicons name="person-add-outline" size={20} color={PRIMARY} />
                                <Text style={styles.inviteBtnText}>{t('chat.inviteFriend')}</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity style={styles.leaveBtn} onPress={handleDeleteChat}>
                            <Ionicons name="trash-outline" size={20} color="#EF4444" />
                            <Text style={styles.leaveBtnText}>
                                {creatorId === currentUserId
                                    ? t('chat.deletePlanHost')
                                    : t('chat.deleteChat')}
                            </Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <Modal
                visible={showInviteFriends}
                transparent
                animationType="slide"
                onRequestClose={() => setShowInviteFriends(false)}
            >
                <View style={styles.membersOverlay}>
                    <View style={styles.membersSheet}>
                        <View style={styles.membersHandle} />
                        <Text style={styles.membersTitle}>{t('chat.inviteFriend')}</Text>
                        {loadingInviteFriends ? (
                            <ActivityIndicator color={PRIMARY} style={{ marginVertical: 24 }} />
                        ) : inviteFriends.length === 0 ? (
                            <Text style={styles.inviteEmpty}>{t('friends.noFriends')}</Text>
                        ) : (
                            <FlatList
                                data={inviteFriends}
                                keyExtractor={(f) => f.id}
                                style={{ maxHeight: 360 }}
                                renderItem={({ item: f }) => {
                                    const busy = invitingFriendId === f.id;
                                    return (
                                        <TouchableOpacity
                                            style={styles.memberRow}
                                            onPress={() => handleInviteFriend(f.id)}
                                            disabled={busy}
                                        >
                                            <Image source={{ uri: getAvatarUri(f) }} style={styles.memberAvatar} />
                                            <Text style={[styles.memberName, { flex: 1 }]}>{f.nombre}</Text>
                                            {busy ? (
                                                <ActivityIndicator color={PRIMARY} size="small" />
                                            ) : (
                                                <Ionicons name="paper-plane-outline" size={20} color={PRIMARY} />
                                            )}
                                        </TouchableOpacity>
                                    );
                                }}
                            />
                        )}
                        <TouchableOpacity style={styles.inviteCloseBtn} onPress={() => setShowInviteFriends(false)}>
                            <Text style={styles.inviteCloseText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F2F2' },
    header: {
        minHeight: 60,
        backgroundColor: '#FFF',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#EEE',
    },
    backBtn: { padding: 5 },
    planHeaderImageWrap: { marginLeft: 5, position: 'relative' },
    planHeaderImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F1F5F9',
    },
    groupPhotoBadge: {
        position: 'absolute',
        right: -4,
        bottom: -4,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    changeGroupPhotoBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#EFF6FF',
        paddingVertical: 12,
        borderRadius: 14,
        marginBottom: 12,
    },
    changeGroupPhotoText: { color: '#2563EB', fontWeight: '800', fontSize: 15 },
    headerTitleContainer: { marginLeft: 10, flex: 1 },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#1E293B' },
    headerSubtitle: { fontSize: 12, color: '#64748B' },
    expiryBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#FEF3C7',
        borderBottomWidth: 1,
        borderBottomColor: '#FCD34D',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    expiryBannerText: { flex: 1, color: '#92400E', fontWeight: '700', fontSize: 13 },
    membersBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF3FB', justifyContent: 'center', alignItems: 'center', marginLeft: 6 },
    membersOverlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.4)', justifyContent: 'flex-end' },
    membersSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34 },
    membersHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#E2E8F0', marginBottom: 14 },
    membersTitle: { fontSize: 18, fontWeight: '900', color: '#0F2A4A', marginBottom: 12 },
    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    memberRowWrap: { flexDirection: 'row', alignItems: 'center' },
    memberKickBtn: { padding: 10 },
    memberAvatar: { width: 46, height: 46, borderRadius: 23, marginRight: 12, backgroundColor: '#E3ECFB' },
    memberName: { fontSize: 16, fontWeight: '700', color: '#0F2A4A' },
    memberCreator: { fontSize: 12, color: PRIMARY, fontWeight: '700', marginTop: 1 },
    inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: '#EFF6FF' },
    inviteBtnText: { color: PRIMARY, fontWeight: '800', fontSize: 15 },
    inviteEmpty: { textAlign: 'center', color: '#94A3B8', fontWeight: '600', marginVertical: 20 },
    inviteCloseBtn: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
    inviteCloseText: { color: '#64748B', fontWeight: '700', fontSize: 15 },
    leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, paddingVertical: 14, borderRadius: 16, backgroundColor: '#FEE2E2' },
    leaveBtnText: { color: '#EF4444', fontWeight: '800', fontSize: 15 },
    loading: { flex: 1, justifyContent: 'center' },
    accessDenied: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        gap: 12,
    },
    accessDeniedTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
    accessDeniedText: { fontSize: 14, color: '#64748B', textAlign: 'center' },
    emptyChat: { padding: 40, alignItems: 'center', transform: [{ scaleY: -1 }] },
    emptyChatText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
    loadMore: { paddingVertical: 16, alignItems: 'center' },
    listContent: { paddingHorizontal: 10, paddingVertical: 20, flexGrow: 1 },
    msgContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
        maxWidth: '85%',
    },
    myMsgContainer: { alignSelf: 'flex-end' },
    otherMsgContainer: { alignSelf: 'flex-start' },
    avatarWrap: { marginRight: 8 },
    avatarWrapMe: { marginLeft: 8 },
    miniAvatar: { width: 32, height: 32, borderRadius: 16 },
    bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, elevation: 1, flexShrink: 1 },
    myBubble: { backgroundColor: '#70B7FF', borderTopRightRadius: 4 },
    otherBubble: { backgroundColor: '#FFF', borderTopLeftRadius: 4 },
    senderName: { fontSize: 12, fontWeight: 'bold', color: PRIMARY, marginBottom: 2 },
    msgText: { fontSize: 16, color: '#1E293B' },
    myMsgText: { color: '#FFF' },
    otherMsgText: { color: '#000' },
    timeText: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end', color: '#94A3B8' },
    myTime: { color: 'rgba(255, 255, 255, 0.7)' },
    otherTime: { color: '#94A3B8' },
    uploadBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 6,
        backgroundColor: '#EFF6FF',
    },
    uploadBannerText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    attachBtn: { paddingHorizontal: 4 },
    inputContainer: {
        flex: 1,
        backgroundColor: '#F1F5F9',
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 4,
        marginHorizontal: 8,
        minHeight: 38,
        justifyContent: 'center',
    },
    textInput: { flex: 1, fontSize: 16, color: '#1E293B', padding: 0, maxHeight: 100 },
    sendCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: PRIMARY,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendCircleDisabled: { backgroundColor: '#CBD5E1' },
    recordingActive: { backgroundColor: '#EF4444' },
    mediaImage: { width: 200, height: 200, borderRadius: 10, marginBottom: 5 },
    videoContainer: { marginBottom: 5 },
    videoPlaceholder: {
        width: 200,
        height: 120,
        borderRadius: 10,
        backgroundColor: '#1E293B',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoLabel: { color: '#FFF', fontSize: 12, marginTop: 4 },
    audioContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minWidth: 140 },
    audioInfo: { flex: 1 },
    audioText: { fontSize: 14, fontWeight: '600' },
    audioDuration: { fontSize: 12, marginTop: 2 },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.9)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalImage: { width: '90%', height: '80%' },
    videoModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
    fullVideo: { width: '100%', height: '80%' },
    modalCloseBtn: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 10,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 20,
        padding: 10,
    },
});
