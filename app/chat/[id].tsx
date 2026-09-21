import {
    Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import React, { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import { Audio,
} from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams,
    useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import {
    ActivityIndicator,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { theme } from '../../theme';
import { createChatStyles } from '../../features/chat/chatStyles';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { ChatMediaModals } from '../../features/chat/ChatMediaModals';
import {
    PAGE_SIZE,
    PLAN_CHAT_TTL_MS,
    planChatKey,
    formatDuration,
    parseStoredDuration,
    mapMessageRow,
    mergeMessages,
    type Message,
    type PlanChatSnapshot,
} from '../../features/chat/chatModel';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMessageRow, chatMessageItemType } from '../../components/ChatMessageRow';
import { ReactionEmojiPicker, applyMessageReaction, useMessageReactions } from '../../components/MessageReactionsBar';
import { PlanImage } from '../../components/PlanImage';
import { PressScale } from '../../components/PressScale';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import {
    isSameChatFile,
    resolveChatFileUrl,
    resolveChatFileUrls,
    uploadChatFile,
} from '../../lib/chatUpload';
import { markPlanChatRead } from '../../lib/chatUnread';
import { clearChatOpenedFromPlan, wasChatOpenedFromPlan } from '../../lib/chatFromPlan';
import { getCoincidedUserIds } from '../../lib/coincidences';
import { getAvatarUri, getFriends, type FriendProfile } from '../../lib/friends';
import { kickParticipant } from '../../lib/kickParticipant';
import { isUserCreatedGroupChat, updateGroupChatPhoto, uploadGroupChatPhoto } from '../../lib/groupChat';
import {
    enqueueChatOutbox,
    flushChatOutbox,
    subscribeOutboxFlush,
} from '../../lib/chatOutbox';
import { encodeReplyContent, previewForReply, type ReplyQuote } from '../../lib/chatReply';
import { isLegacyPlanCreatedNotice } from '../../lib/chatSystem';
import { isPlanChatMuted, setPlanChatMuted } from '../../lib/chatMute';
import { hapticLight, hapticMedium, hapticToggle } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { getIsOnline } from '../../lib/network';
import { hidePlanChat, unhidePlanChat } from '../../lib/planChatHide';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../../lib/planDetailCache';
import { setActiveConversation } from '../../lib/activeConversation';
import { cancelPlanLifecycleReminders } from '../../lib/push';
import { trackFunnel } from '../../lib/analytics';
import { sendPlanInvite } from '../../lib/planInvites';
import {
    CHAT_EXPIRY_WARN_MS,
    formatCountdown,
    getChatExpiryMs,
    isGroupOrChatPlan,
    isPlanActiveForSaved,
    isPlanChatAlive,
    runPlanLifecycleMaintenance,
} from '../../lib/planLifecycle';
import { PlanShareModal, buildPlanSharePayload, type PlanSharePayload } from '../../components/PlanShareModal';
import { resolvePlanImageSource } from '../../lib/sports';
import { getAuthUser } from '../../lib/auth';
import { useAuthSession } from '../../lib/authSession';
import { invalidatePlanMembershipCaches } from '../../lib/screenCaches';
import { broadcastPlanMembership } from '../../lib/membershipBroadcast';
import { cacheGetStale, cacheSet } from '../../lib/ttlCache';
import { supabase } from '../../lib/supabase';
import { getPublicProfileCards } from '../../lib/profileData';

const PRIMARY = theme.colors.brand;
const DANGER = theme.colors.danger;
export default function ChatScreen() {
    const { id, fromPlan } = useLocalSearchParams<{ id: string | string[]; fromPlan?: string | string[] }>();
    const planId = Array.isArray(id) ? id[0] : id;
    const openedFromPlan = (Array.isArray(fromPlan) ? fromPlan[0] : fromPlan) === '1';
    const router = useRouter();
    const { t, lang } = useT();
    const { userId: sessionUserId } = useAuthSession();
    const { scheme } = useAppTheme();
    const styles = useThemedStyles(createChatStyles);
    const headerHeight = useHeaderHeight();
    const insets = useSafeAreaInsets();
    const [keyboardOpen, setKeyboardOpen] = useState(false);

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const show = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
        const hide = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    const cachedChat = planId ? cacheGetStale<PlanChatSnapshot>(planChatKey(planId)) : null;

    const [planName, setPlanName] = useState(() => cachedChat?.planName ?? '');
    const [planImage, setPlanImage] = useState<string | null>(() => cachedChat?.planImage ?? null);
    const [participantNames, setParticipantNames] = useState(() => cachedChat?.participantNames ?? '');
    const [isGroupChat, setIsGroupChat] = useState(() => cachedChat?.isGroupChat ?? false);
    const [planCategory, setPlanCategory] = useState<string | null>(() => cachedChat?.planCategory ?? null);
    const [planOwnerId, setPlanOwnerId] = useState<string | null>(() => cachedChat?.planOwnerId ?? null);
    const [uploadingGroupPhoto, setUploadingGroupPhoto] = useState(false);
    const [members, setMembers] = useState<{ id: string; nombre: string; avatar_url: string | null; isCreator: boolean; genero?: string | null }[]>(
        () => cachedChat?.members ?? [],
    );
    const [showInviteFriends, setShowInviteFriends] = useState(false);
    const [inviteFriends, setInviteFriends] = useState<(FriendProfile & { friendshipId: string })[]>([]);
    const [loadingInviteFriends, setLoadingInviteFriends] = useState(false);
    const [invitingFriendId, setInvitingFriendId] = useState<string | null>(null);
    const [creatorId, setCreatorId] = useState<string | null>(() => cachedChat?.creatorId ?? null);
    const [modoPrivado, setModoPrivado] = useState(() => cachedChat?.modoPrivado ?? false);
    const [showMembers, setShowMembers] = useState(false);
    const [messageText, setMessageText] = useState('');
    const [replyTo, setReplyTo] = useState<ReplyQuote | null>(null);
    const [chatMuted, setChatMuted] = useState(false);
    const [typingNames, setTypingNames] = useState<string[]>([]);
    const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [messages, setMessages] = useState<Message[]>(() => cachedChat?.messages ?? []);
    const [loading, setLoading] = useState(() => !(cachedChat?.messages?.length));
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(() => cachedChat?.hasMore ?? true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(sessionUserId);
    const [accessDenied, setAccessDenied] = useState(() => cachedChat?.accessDenied ?? false);
    const [planFechaEvento, setPlanFechaEvento] = useState<string | null>(() => cachedChat?.planFechaEvento ?? null);
    const [planLocationName, setPlanLocationName] = useState<string | null>(null);
    const [chatExpiryLabel, setChatExpiryLabel] = useState<string | null>(null);
    const [friendIds, setFriendIds] = useState<Set<string>>(() => new Set());
    const [coincidedIds, setCoincidedIds] = useState<Set<string>>(() => new Set());
    const [isSaved, setIsSaved] = useState(false);

    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
    const [modalImage, setModalImage] = useState<string | null>(null);
    const [modalVideo, setModalVideo] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const sendLockRef = useRef(false);
    const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);

    const soundRef = useRef<Audio.Sound | null>(null);
    const isMountedRef = useRef(true);
    const loadingDurationsRef = useRef<Set<string>>(new Set());
    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
    const { reactions, setReactions } = useMessageReactions(messageIds);

    const myProfile = useMemo(() => {
        const me = members.find((m) => m.id === currentUserId);
        return {
            nombre: me?.nombre || t('chats.you'),
            avatar_url: me?.avatar_url ?? null,
        };
    }, [members, currentUserId, t]);

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
            .select('creador_id')
            .eq('id', pid)
            .single();

        const { data: parts } = await supabase
            .from('participantes')
            .select('usuario_id, estado')
            .eq('plan_id', pid);

        const ownerId = (planData?.creador_id as string) ?? null;
        setCreatorId(ownerId);

        const byId = new Map<string, { id: string; nombre: string; avatar_url: string | null; isCreator: boolean; genero?: string | null }>();

        const profileIds = [
            ...(ownerId ? [ownerId] : []),
            ...(parts ?? [])
                .filter((part) => part.estado === 'aceptado')
                .map((part) => part.usuario_id),
        ];
        const publicProfiles = await getPublicProfileCards(profileIds);
        const profileMap = new Map(publicProfiles.map((profile) => [profile.id, profile]));
        const creator = ownerId ? profileMap.get(ownerId) : null;
        if (ownerId) {
            byId.set(ownerId, {
                id: ownerId,
                nombre: creator?.nombre || t('chat.host'),
                avatar_url: creator?.avatar_url ?? null,
                isCreator: true,
                genero: creator?.genero ?? null,
            });
        }

        (parts ?? []).forEach((p: any) => {
            if (p.estado !== 'aceptado') return;
            const uid = p.usuario_id as string;
            if (!uid || byId.has(uid)) return;
            const profile = profileMap.get(uid);
            byId.set(uid, {
                id: uid,
                nombre: profile?.nombre || t('profile.user'),
                avatar_url: profile?.avatar_url ?? null,
                isCreator: uid === ownerId,
                genero: profile?.genero ?? null,
            });
        });

        const list = Array.from(byId.values());
        setMembers(list);

        const names = list.length === 0
            ? t('chat.noParticipants')
            : list.map((m) => m.nombre).join(', ');
        setParticipantNames(names);
        return { members: list, participantNames: names, creatorId: ownerId };
    }, [t]);

    const persistPlanChatCache = useCallback((
        pid: string,
        patch: Partial<PlanChatSnapshot> & { messages: Message[] },
    ) => {
        const prev = cacheGetStale<PlanChatSnapshot>(planChatKey(pid));
        cacheSet(planChatKey(pid), {
            messages: patch.messages,
            planName: patch.planName ?? prev?.planName ?? '',
            planImage: patch.planImage !== undefined ? patch.planImage : (prev?.planImage ?? null),
            participantNames: patch.participantNames ?? prev?.participantNames ?? '',
            isGroupChat: patch.isGroupChat ?? prev?.isGroupChat ?? false,
            planCategory: patch.planCategory !== undefined ? patch.planCategory : (prev?.planCategory ?? null),
            planOwnerId: patch.planOwnerId !== undefined ? patch.planOwnerId : (prev?.planOwnerId ?? null),
            members: patch.members ?? prev?.members ?? [],
            creatorId: patch.creatorId !== undefined ? patch.creatorId : (prev?.creatorId ?? null),
            planFechaEvento: patch.planFechaEvento !== undefined ? patch.planFechaEvento : (prev?.planFechaEvento ?? null),
            modoPrivado: patch.modoPrivado ?? prev?.modoPrivado ?? false,
            accessDenied: patch.accessDenied ?? prev?.accessDenied ?? false,
            hasMore: patch.hasMore ?? prev?.hasMore ?? true,
        }, PLAN_CHAT_TTL_MS);
    }, []);

    const canInvitePeople =
        !accessDenied &&
        !!currentUserId &&
        !!creatorId &&
        (creatorId === currentUserId || !modoPrivado);

    const openInviteFriends = useCallback(async () => {
        if (!currentUserId || !canInvitePeople) return;
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
    }, [currentUserId, members, canInvitePeople]);

    const handleInviteFriend = useCallback(
        async (friendId: string) => {
            if (!planId || !currentUserId || !canInvitePeople) return;
            setInvitingFriendId(friendId);
            const tipo = isGroupChat ? 'grupo' : 'plan';
            const { error } = await sendPlanInvite(planId, currentUserId, friendId, tipo);
            setInvitingFriendId(null);
            if (error === 'already_member' || error === 'already_invited') {
                Alert.alert(t('login.notice'), t('friends.inviteAlready'));
                return;
            }
            if (error === 'organizer_cannot_join') {
                Alert.alert(t('profile.error'), t('organizer.cannotInvite'));
                return;
            }
            if (error) {
                Alert.alert(t('profile.error'), error.includes('plan_invitaciones') ? t('friends.invitesSqlHint') : t('chat.inviteError'));
                return;
            }
            Alert.alert(t('login.notice'), t('chat.inviteSent'));
        },
        [planId, currentUserId, isGroupChat, canInvitePeople, t]
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

        const pick = async (useCamera: boolean) => {
            try {
                if (useCamera) {
                    const current = await ImagePicker.getCameraPermissionsAsync();
                    const cam = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
                    if (!cam.granted) {
                        Alert.alert(t('onboarding.notice'), t('onboarding.cameraPermission'));
                        return;
                    }
                } else {
                    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
                    const lib = current.granted ? current : await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!lib.granted) {
                        Alert.alert(t('onboarding.notice'), t('onboarding.galleryPermission'));
                        return;
                    }
                }

                // Tras cerrar el alert custom, iOS necesita un frame libre para presentar el picker.
                await new Promise((r) => setTimeout(r, 350));

                const result = useCamera
                    ? await ImagePicker.launchCameraAsync({
                        mediaTypes: ['images'],
                        allowsEditing: Platform.OS === 'ios',
                        aspect: [1, 1],
                        quality: 0.5,
                    })
                    : await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'],
                        allowsEditing: Platform.OS === 'ios',
                        aspect: [1, 1],
                        quality: 0.5,
                    });

                if (!result.canceled && result.assets[0]?.uri) {
                    await handleGroupPhotoPicked(result.assets[0].uri);
                }
            } catch (e) {
                if (__DEV__) console.error('group photo picker:', e);
                Alert.alert(t('profile.error'), t('chat.groupPhotoError'));
            }
        };

        Alert.alert(t('chat.groupPhotoTitle'), t('chat.groupPhotoChoice'), [
            { text: t('profile.camera'), onPress: () => { void pick(true); } },
            { text: t('profile.gallery'), onPress: () => { void pick(false); } },
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    }, [canEditGroupPhoto, uploadingGroupPhoto, handleGroupPhotoPicked, t]);

    const handleDeleteChat = useCallback(() => {
        if (!planId || !currentUserId) return;
        const isHost = creatorId === currentUserId;
        const planStarted =
            !!planFechaEvento &&
            Number.isFinite(new Date(planFechaEvento).getTime()) &&
            Date.now() >= new Date(planFechaEvento).getTime();
        // Tras el evento: solo ocultar chat (no salir del plan). Antes: salir del plan.
        const leavePlan = !isHost && !planStarted;

        const title = isHost
            ? t('chat.deletePlanHost')
            : leavePlan
              ? t('chat.deleteChatAndLeave')
              : t('chat.deleteChat');
        const message = isHost
            ? t('chat.deletePlanHostConfirm')
            : leavePlan
              ? t('chat.deleteChatConfirm')
              : t('chat.deleteChatOnlyConfirm');
        const actionLabel = isHost
            ? t('chat.deletePlanHost')
            : leavePlan
              ? t('chat.deleteChatAndLeave')
              : t('chat.deleteChat');

        setShowMembers(false);
        setTimeout(() => {
            Alert.alert(title, message, [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: actionLabel,
                    style: 'destructive',
                    // No async aquí: en Android el Alert espera el Promise y se queda abierto.
                    onPress: () => {
                        void (async () => {
                            if (isHost) {
                                const { error } = await deletePlanCompletely(planId);
                                if (error) {
                                    Alert.alert(t('profile.error'), t('chat.deletePlanError') + ': ' + error);
                                    return;
                                }
                                void cancelPlanLifecycleReminders(planId);
                                invalidatePlanMembershipCaches(currentUserId);
                            } else if (leavePlan) {
                                const { error } = await supabase
                                    .from('participantes')
                                    .delete()
                                    .eq('plan_id', planId)
                                    .eq('usuario_id', currentUserId);
                                if (error) {
                                    Alert.alert(t('profile.error'), error.message);
                                    return;
                                }
                                void cancelPlanLifecycleReminders(planId);
                                broadcastPlanMembership(planId, 'none', {
                                    userId: currentUserId,
                                    dropJoined: true,
                                });
                            } else {
                                await hidePlanChat(currentUserId, planId);
                                invalidatePlanMembershipCaches(currentUserId);
                            }
                            router.back();
                        })();
                    },
                },
            ]);
        }, 250);
    }, [planId, currentUserId, creatorId, planFechaEvento, t, router]);

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
            return resolveChatFileUrls(rows);
        },
        []
    );

    const loadMoreMessages = useCallback(async () => {
        const current = messagesRef.current;
        if (!planId || loadingMore || !hasMore || current.length === 0) return;

        setLoadingMore(true);
        try {
            const oldest = current[current.length - 1];
            const older = await fetchMessages(planId, oldest.creado_en);

            const nextHasMore = older.length >= PAGE_SIZE;
            if (!nextHasMore) setHasMore(false);

            setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const unique = older.filter((m) => !existingIds.has(m.id));
                const next = [...prev, ...unique];
                if (planId) persistPlanChatCache(planId, { messages: next, hasMore: nextHasMore });
                return next;
            });
        } catch (error) {
            if (__DEV__) console.error('Error cargando más mensajes:', error);
        } finally {
            setLoadingMore(false);
        }
    }, [planId, loadingMore, hasMore, fetchMessages, persistPlanChatCache]);

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
            /* duración opcional */
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
            const stale = cacheGetStale<PlanChatSnapshot>(planChatKey(planId));
            if (stale && (stale.messages?.length || stale.planName)) {
                if (stale.messages?.length) setMessages(stale.messages);
                setPlanName(stale.planName);
                setPlanImage(stale.planImage);
                setParticipantNames(stale.participantNames);
                setIsGroupChat(stale.isGroupChat);
                setPlanCategory(stale.planCategory);
                setPlanOwnerId(stale.planOwnerId);
                setMembers(stale.members);
                setCreatorId(stale.creatorId);
                setPlanFechaEvento(stale.planFechaEvento);
                setModoPrivado(stale.modoPrivado ?? false);
                setAccessDenied(stale.accessDenied);
                setHasMore(stale.hasMore);
                // Header al instante; spinner solo si aún no hay mensajes.
                setLoading(!(stale.messages?.length));
            } else {
                setLoading(true);
                setAccessDenied(false);
                setHasMore(true);
            }

            try {
                const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
                if (!isMountedRef.current) return;

                if (!userId) {
                    router.replace('/login');
                    return;
                }

                setCurrentUserId(userId);

                void runPlanLifecycleMaintenance();

                void Promise.all([
                    getFriends(userId),
                    getCoincidedUserIds(userId),
                    supabase
                        .from('planes_guardados')
                        .select('plan_id')
                        .eq('plan_id', planId)
                        .eq('usuario_id', userId)
                        .maybeSingle(),
                ]).then(([friends, coincided, savedRes]) => {
                    if (!isMountedRef.current) return;
                    setFriendIds(new Set(friends.map((f) => f.id)));
                    setCoincidedIds(coincided);
                    setIsSaved(!!savedRes.data);
                });

                const { data: planData, error: planError } = await supabase
                    .from('planes')
                    .select('titulo, imagen_url, creador_id, categoria, fecha_evento, chat_eliminado_en, modo_privado, nombre_ubicacion')
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
                setPlanLocationName(planData.nombre_ubicacion ?? null);

                const { data: membership } = await supabase
                    .from('participantes')
                    .select('usuario_id, estado')
                    .eq('plan_id', planId)
                    .eq('usuario_id', userId)
                    .maybeSingle();

                const isCreator = planData.creador_id === userId;
                const canAccessChat = isCreator || membership?.estado === 'aceptado';
                if (!canAccessChat) {
                    setAccessDenied(true);
                    setPlanName(planData.titulo);
                    setPlanImage(planData.imagen_url);
                    persistPlanChatCache(planId, {
                        messages: [],
                        planName: planData.titulo,
                        planImage: planData.imagen_url,
                        accessDenied: true,
                        hasMore: false,
                    });
                    return;
                }

                if (!isMountedRef.current) return;

                setAccessDenied(false);
                setPlanCategory(planData.categoria ?? null);
                setPlanOwnerId(planData.creador_id ?? null);
                setCreatorId(planData.creador_id ?? null);
                setModoPrivado(!!planData.modo_privado);
                setIsGroupChat(planData.categoria === 'Grupo');

                setPlanName(planData.titulo);
                setPlanImage(planData.imagen_url ?? null);

                const [initialMessages, partsMeta] = await Promise.all([
                    fetchMessages(planId),
                    fetchParticipants(planId),
                ]);

                if (!isMountedRef.current) return;

                const merged = mergeMessages(initialMessages, stale?.messages ?? []);
                setMessages(merged);
                const nextHasMore = initialMessages.length >= PAGE_SIZE || (stale?.hasMore ?? false);
                setHasMore(nextHasMore);
                void markPlanChatRead(userId, planId);

                persistPlanChatCache(planId, {
                    messages: merged,
                    planName: planData.titulo,
                    planImage: planData.imagen_url ?? null,
                    participantNames: partsMeta.participantNames,
                    isGroupChat: planData.categoria === 'Grupo',
                    planCategory: planData.categoria ?? null,
                    planOwnerId: planData.creador_id ?? null,
                    members: partsMeta.members,
                    creatorId: partsMeta.creatorId,
                    planFechaEvento: planData.fecha_evento ?? null,
                    modoPrivado: !!planData.modo_privado,
                    accessDenied: false,
                    hasMore: nextHasMore,
                });

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

                            if (
                                newMessage.tipo === 'texto'
                                && isLegacyPlanCreatedNotice(newMessage.contenido)
                            ) {
                                return;
                            }

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
                                    persistPlanChatCache(planId, { messages: next });
                                    return next;
                                });
                                if (payload.new.emisor_id !== userId) {
                                    void unhidePlanChat(userId, planId);
                                    void markPlanChatRead(userId, planId);
                                }
                            }
                        }
                    )
                    .subscribe();
            } catch (error) {
                console.error('Error en initChat:', error);
                if (!stale?.messages?.length) {
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
    }, [planId, router, fetchMessages, fetchParticipants, persistPlanChatCache, sessionUserId, t]);

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
            if (remaining > CHAT_EXPIRY_WARN_MS) {
                setChatExpiryLabel(null);
                return;
            }
            setChatExpiryLabel(formatCountdown(remaining));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [planFechaEvento, planCategory, router, t]);

    useEffect(() => {
        if (!planId) return;
        const unsub = subscribeOutboxFlush((ev) => {
            if (ev.kind !== 'plan' || ev.planId !== planId) return;
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.id === ev.tempId
                        ? { ...m, id: ev.serverId, creado_en: ev.creadoEn, pending: false }
                        : m,
                );
                persistPlanChatCache(planId, { messages: next });
                return next;
            });
        });
        if (getIsOnline()) void flushChatOutbox();
        return unsub;
    }, [planId, persistPlanChatCache]);

    useEffect(() => {
        if (!planId || !currentUserId) return;
        void isPlanChatMuted(planId).then(setChatMuted);
        trackFunnel('chat_open', { userId: currentUserId, props: { planId } });
    }, [planId, currentUserId]);

    const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    useEffect(() => {
        if (!planId || !currentUserId || accessDenied) return;
        const channel = supabase.channel(`typing:plan:${planId}`);
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
                typingMap.set(uid, { name: name || 'Alguien', at: Date.now() });
                refreshTyping();
            })
            .subscribe();

        const tick = setInterval(refreshTyping, 1000);
        return () => {
            clearInterval(tick);
            typingChannelRef.current = null;
            void supabase.removeChannel(channel);
        };
    }, [planId, currentUserId, accessDenied]);

    const emitTyping = useCallback(() => {
        if (!currentUserId || accessDenied) return;
        const name = myProfile?.nombre || 'Alguien';
        void typingChannelRef.current?.send({
            type: 'broadcast',
            event: 'typing',
            payload: { userId: currentUserId, name },
        });
    }, [currentUserId, accessDenied, myProfile?.nombre]);

    const onMessageTextChange = useCallback(
        (text: string) => {
            setMessageText(text);
            if (!text.trim()) return;
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => emitTyping(), 350);
        },
        [emitTyping],
    );

    const toggleMuteChat = useCallback(async () => {
        if (!planId) return;
        const next = !chatMuted;
        hapticToggle(!next);
        setChatMuted(next);
        await setPlanChatMuted(planId, next);
    }, [planId, chatMuted]);

    useFocusEffect(
        useCallback(() => {
            refreshChatHeader();
            if (planId) setActiveConversation({ kind: 'plan', id: planId });
            if (currentUserId && planId && !accessDenied) {
                void markPlanChatRead(currentUserId, planId);
            }
            return () => {
                setActiveConversation(null);
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
        if (!currentUserId || !planId || accessDenied || isSending || sendLockRef.current) return;

        void unhidePlanChat(currentUserId, planId);

        const tempText = messageText.trim();
        if (tipo === 'texto' && !tempText) return;

        sendLockRef.current = true;
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
            persistPlanChatCache(planId, { messages: next });
            return next;
        });
        // Liberar input al instante; el mensaje ya es optimista.
        setIsSending(false);
        setTimeout(() => {
            sendLockRef.current = false;
        }, 220);

        if (!getIsOnline()) {
            if (tipo !== 'texto') {
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                Alert.alert(t('chat.errorTitle'), t('chat.mediaNeedsNetwork'));
                return;
            }
            await enqueueChatOutbox({
                tempId,
                kind: 'plan',
                planId,
                emisorId: currentUserId,
                contenido: contenidoPayload,
                tipo,
                archivoUrl,
                createdAt: optimistic.creado_en,
            });
            return;
        }

        const { data, error } = await supabase
            .from('mensajes')
            .insert({
                plan_id: planId,
                contenido: contenidoPayload,
                emisor_id: currentUserId,
                tipo,
                archivo_url: archivoUrl,
            })
            .select('id, creado_en')
            .maybeSingle();

        if (error) {
            if (tipo === 'texto') {
                await enqueueChatOutbox({
                    tempId,
                    kind: 'plan',
                    planId,
                    emisorId: currentUserId,
                    contenido: contenidoPayload,
                    tipo,
                    archivoUrl,
                    createdAt: optimistic.creado_en,
                });
                setMessages((prev) => {
                    const next = prev.map((m) => (m.id === tempId ? { ...m, pending: true } : m));
                    persistPlanChatCache(planId, { messages: next });
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
                persistPlanChatCache(planId, { messages: next });
                return next;
            });
        }

        if (data?.id) {
            const { notifyPlanMessage } = await import('../../lib/push');
            notifyPlanMessage(planId, String(data.id));
        }
        trackFunnel('chat_send', { userId: currentUserId, props: { planId, tipo } });
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
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

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

    const inputDisabled = isUploading || isSending || accessDenied;
    const actionIcon = useMemo(() => {
        if (isUploading || isSending) return 'hourglass';
        if (messageText.trim()) return 'send';
        if (recording) return 'stop';
        return 'mic';
    }, [isUploading, isSending, messageText, recording]);

    const openMessageProfile = useCallback(
        (userId: string) => {
            router.push({
                pathname: '/user-profile/[id]',
                params: {
                    id: userId,
                    isFriend: friendIds.has(userId) ? '1' : '0',
                },
            });
        },
        [router, friendIds],
    );

    const toggleSavePlan = useCallback(async () => {
        if (!currentUserId || !planId || creatorId === currentUserId) return;
        const prev = isSaved;
        hapticLight();
        setIsSaved(!prev);
        if (prev) {
            const { error } = await supabase
                .from('planes_guardados')
                .delete()
                .eq('plan_id', planId)
                .eq('usuario_id', currentUserId);
            if (error) {
                setIsSaved(prev);
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        } else {
            if (planFechaEvento && !isPlanActiveForSaved({ fecha_evento: planFechaEvento })) {
                setIsSaved(prev);
                return;
            }
            const { error } = await supabase
                .from('planes_guardados')
                .insert({ plan_id: planId, usuario_id: currentUserId });
            if (error) {
                setIsSaved(prev);
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        }
    }, [currentUserId, planId, creatorId, isSaved, planFechaEvento, t]);

    const [sharePayload, setSharePayload] = useState<PlanSharePayload | null>(null);

    const handleSharePlan = useCallback(() => {
        if (!planId) return;
        const title = planName.trim() || 'Plan';
        let when = '';
        if (planFechaEvento) {
            const d = new Date(planFechaEvento);
            if (Number.isFinite(d.getTime())) {
                when = d.toLocaleString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                });
            }
        }
        const start = () => {
            setSharePayload(
                buildPlanSharePayload({
                    planId,
                    title,
                    coverUrl: planImage,
                    when,
                    location: planLocationName,
                    participants: members.map((m) => ({
                        id: m.id,
                        nombre: m.nombre,
                        avatar_url: m.avatar_url,
                    })),
                    maxPeople: members.length,
                }),
            );
        };
        Alert.alert(t('card.share'), `"${title}"`, [
            { text: t('card.shareWhats'), onPress: start },
            { text: t('card.shareOther'), onPress: start },
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    }, [planId, planName, planFechaEvento, planLocationName, planImage, members, t]);

    const relationFor = useCallback(
        (userId: string): 'friend' | 'acquaintance' | null => {
            if (!userId || userId === currentUserId) return null;
            if (friendIds.has(userId)) return 'friend';
            if (coincidedIds.has(userId)) return 'acquaintance';
            return null;
        },
        [currentUserId, friendIds, coincidedIds],
    );

    const seedPlanFromChat = useCallback(() => {
        if (!planId) return;
        seedPlanDetailFromFeed(
            {
                id: planId,
                titulo: planName,
                imagen_url: planImage,
                categoria: planCategory ?? '',
                creador_id: creatorId ?? planOwnerId ?? '',
                fecha_evento: planFechaEvento,
                nombre_ubicacion: planLocationName,
                modo_privado: modoPrivado,
                participantsList: members.map((m) => ({
                    id: m.id,
                    nombre: m.nombre,
                    avatar_url: m.avatar_url,
                    isCreator: m.isCreator,
                    genero: m.genero ?? null,
                })),
                joinedCount: members.length,
                host: members.find((m) => m.isCreator) ?? members[0] ?? null,
            },
            { membership: 'joined' },
        );
        prefetchPlanDetail(planId);
    }, [
        planId,
        planName,
        planImage,
        planCategory,
        creatorId,
        planOwnerId,
        planFechaEvento,
        planLocationName,
        modoPrivado,
        members,
    ]);

    const openPlanFromChat = useCallback(() => {
        if (!planId) return;
        seedPlanFromChat();
        const fromPlanNav =
            openedFromPlan ||
            wasChatOpenedFromPlan(planId);
        // Nunca apilar otro plan/[id] encima del chat si venimos del mismo detalle:
        // eso duplica la ruta y puede expulsar/cerrar la app.
        if (fromPlanNav) {
            clearChatOpenedFromPlan(planId);
            if (router.canGoBack()) {
                router.back();
                return;
            }
            router.replace({ pathname: '/plan/[id]', params: { id: planId, from: 'chat' } });
            return;
        }
        router.replace({ pathname: '/plan/[id]', params: { id: planId, from: 'chat' } });
    }, [planId, router, seedPlanFromChat, openedFromPlan]);

    const openChatHeaderInfo = useCallback(() => {
        if (isCreatedGroupChat) {
            setShowMembers(true);
            return;
        }
        openPlanFromChat();
    }, [isCreatedGroupChat, openPlanFromChat]);

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
                        name: name || 'Usuario',
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

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity
                    onPress={() => {
                        clearChatOpenedFromPlan(planId);
                        router.back();
                    }}
                    style={styles.backBtn}
                >
                    <Ionicons name="chevron-back" size={28} color={PRIMARY} />
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={
                        canEditGroupPhoto
                            ? showGroupPhotoMenu
                            : openChatHeaderInfo
                    }
                    onPressIn={canEditGroupPhoto || isCreatedGroupChat ? undefined : seedPlanFromChat}
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
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={planId}
                            transition={0}
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
                                <ActivityIndicator size="small" color={theme.colors.surface} />
                            ) : (
                                <Ionicons name="camera" size={14} color={theme.colors.surface} />
                            )}
                        </View>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.headerTitleContainer}
                    activeOpacity={0.7}
                    onPressIn={isCreatedGroupChat ? undefined : seedPlanFromChat}
                    onPress={openChatHeaderInfo}
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
                <TouchableOpacity onPress={() => void toggleMuteChat()} style={styles.membersBtn} hitSlop={6}>
                    <Ionicons
                        name={chatMuted ? 'notifications-off' : 'notifications-outline'}
                        size={20}
                        color={chatMuted ? theme.colors.textSubtle : PRIMARY}
                    />
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
                behavior="padding"
                keyboardVerticalOffset={Platform.OS === 'ios' ? Math.max(0, headerHeight - 10) : 0}
            >
                {loading && !planName && messages.length === 0 ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={PRIMARY} size="large" />
                    </View>
                ) : accessDenied ? (
                    <View style={styles.accessDenied}>
                        <Ionicons name="lock-closed-outline" size={48} color={theme.colors.textSubtle} />
                        <Text style={styles.accessDeniedTitle}>{t('chat.accessDenied')}</Text>
                        <Text style={styles.accessDeniedText}>
                            {t('chat.accessDeniedSub')}
                        </Text>
                    </View>
                ) : (
                    <View style={styles.messagesPanel}>
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
                        {loading && messages.length === 0 ? (
                            <View style={styles.emptyChatOverlay} pointerEvents="none">
                                <ActivityIndicator color={PRIMARY} size="large" />
                            </View>
                        ) : messages.length === 0 ? (
                            <View style={styles.emptyChatOverlay} pointerEvents="none">
                                <Text style={styles.emptyChatText}>{t('chat.emptyThread')}</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                {!accessDenied && typingNames.length > 0 ? (
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

                <View style={[styles.inputBar, { paddingBottom: keyboardOpen ? 4 : (Platform.OS === 'android' ? 12 : Math.max(insets.bottom, 10)) + 10 }]}>
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
                            testID="group-chat-message-input"
                            placeholder={
                                recording
                                    ? `${t('chat.recording')} ${formatDuration(recordingDuration)}...`
                                    : accessDenied
                                      ? t('chat.cannotWrite')
                                      : ''
                            }
                            placeholderTextColor={theme.colors.textMuted}
                            keyboardAppearance={scheme}
                            style={styles.textInput}
                            value={messageText}
                            onChangeText={onMessageTextChange}
                            multiline
                            editable={!recording && !inputDisabled}
                        />
                    </View>

                    <PressScale
                        testID="group-chat-send"
                        accessibilityLabel="Enviar mensaje"
                        onPress={handleActionPress}
                        style={[
                            styles.sendCircle,
                            recording && styles.recordingActive,
                            inputDisabled && styles.sendCircleDisabled,
                        ]}
                        disabled={inputDisabled && !recording}
                        pressedScale={0.86}
                        minTouch={false}
                        haptic={false}
                    >
                        <Ionicons name={actionIcon} size={18} color="white" />
                    </PressScale>
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

            <ChatMediaModals
                imageUrl={modalImage}
                videoUrl={modalVideo}
                onCloseImage={() => setModalImage(null)}
                onCloseVideo={() => setModalVideo(null)}
            />

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
                            renderItem={({ item: m }) => {
                                const relation = relationFor(m.id);
                                return (
                                <View style={styles.memberRowWrap}>
                                    <TouchableOpacity
                                        style={[styles.memberRow, { flex: 1 }]}
                                        onPress={() => {
                                            setShowMembers(false);
                                            router.push({
                                                pathname: '/user-profile/[id]',
                                                params: {
                                                    id: m.id,
                                                    isFriend: relation === 'friend' ? '1' : '0',
                                                },
                                            });
                                        }}
                                    >
                                        <Image
                                            source={{ uri: m.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.nombre)}&background=4DA6FF&color=fff` }}
                                            style={styles.memberAvatar}
                                            contentFit="cover"
                                            cachePolicy="memory-disk"
                                            recyclingKey={m.id}
                                            transition={0}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.memberName}>{m.nombre}</Text>
                                            {m.isCreator ? (
                                                <Text style={styles.memberCreator}>
                                                    {t(m.genero === 'femenino' ? 'chat.hostF' : 'chat.host')}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                                    </TouchableOpacity>
                                    {creatorId === currentUserId && !m.isCreator && currentUserId && planId && (
                                        <TouchableOpacity
                                            style={styles.memberKickBtn}
                                            onPress={() => {
                                                const targetId = m.id;
                                                const targetName = m.nombre;
                                                setShowMembers(false);
                                                // Cerrar el sheet antes del Alert: si no, en Android se queda trabado
                                                // (modal anidado + onPress async).
                                                setTimeout(() => {
                                                    Alert.alert(
                                                        t('planDetail.kickTitle'),
                                                        t('planDetail.kickMsg', { name: targetName }),
                                                        [
                                                            { text: t('common.cancel'), style: 'cancel' },
                                                            {
                                                                text: t('planDetail.kickConfirm'),
                                                                style: 'destructive',
                                                                onPress: () => {
                                                                    void (async () => {
                                                                        const { error } = await kickParticipant(
                                                                            planId,
                                                                            targetId,
                                                                            currentUserId,
                                                                        );
                                                                        if (error) {
                                                                            Alert.alert(t('chat.errorTitle'), error);
                                                                            return;
                                                                        }
                                                                        await fetchParticipants(planId);
                                                                    })();
                                                                },
                                                            },
                                                        ],
                                                    );
                                                }, 250);
                                            }}
                                        >
                                            <Ionicons name="ban-outline" size={20} color={theme.colors.danger} />
                                        </TouchableOpacity>
                                    )}
                                </View>
                                );
                            }}
                        />

                        {canInvitePeople ? (
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
                        ) : null}

                        <TouchableOpacity style={styles.muteBtn} onPress={() => void toggleMuteChat()}>
                            <Ionicons
                                name={chatMuted ? 'notifications-off' : 'notifications-outline'}
                                size={20}
                                color={PRIMARY}
                            />
                            <Text style={styles.muteBtnText}>
                                {chatMuted ? t('chat.unmute') : t('chat.mute')}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.leaveBtn} onPress={handleDeleteChat}>
                            <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                            <Text style={styles.leaveBtnText}>
                                {creatorId === currentUserId
                                    ? t('chat.deletePlanHost')
                                    : planFechaEvento &&
                                        Number.isFinite(new Date(planFechaEvento).getTime()) &&
                                        Date.now() >= new Date(planFechaEvento).getTime()
                                      ? t('chat.deleteChat')
                                      : t('chat.deleteChatAndLeave')}
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
                                            <Image
                                                source={{ uri: getAvatarUri(f) }}
                                                style={styles.memberAvatar}
                                                contentFit="cover"
                                                cachePolicy="memory-disk"
                                                recyclingKey={f.id}
                                                transition={0}
                                            />
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

            <PlanShareModal payload={sharePayload} onDone={() => setSharePayload(null)} />
        </View>
    );
}
