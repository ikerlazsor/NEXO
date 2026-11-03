import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage, type ImageStyle } from 'expo-image';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    memo } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    type StyleProp,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { Marker } from 'react-native-maps';
import { NexoMapView } from './NexoMapView';
import { canJoinWaitlist, type Membership } from '../lib/participants';
import { canJoinPlanByGender, isSoloChicasPlan } from '../lib/soloChicas';
import { allFemaleGenero } from '../lib/profileFields';
import { kickParticipant } from '../lib/kickParticipant';
import { BounceHeart } from './BounceHeart';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../lib/haptics';
import { emitHeartBurst } from '../lib/heartBurst';
import { useAuthSession } from '../lib/authSession';
import { useT } from '../lib/i18n';
import { localeTag } from '../lib/locale';
import { sharePlanLink } from '../lib/sharePlan';
import { fetchTournamentConfig } from '../lib/footballTournament';
import { requestTournamentShare } from '../lib/shareTournamentPitch';
import { resolvePlanSport } from '../lib/categories';
import { prioritizeTournamentPrefetch } from '../lib/tournamentLineupCache';
import { prefetchPlanDetail } from '../lib/planDetailCache';
import { getPlanPendingInvitees, sendPlanInvite, cancelPlanInvite } from '../lib/planInvites';
import { formatSocialJoinedBanner } from '../lib/socialJoinedBanner';
import { feedFitPercent, type FeedTaste } from '../lib/feedAffinity';
import { storageThumbUrl, WEBP_ACCEPT_HEADERS } from '../lib/storageImage';
import { FitMatchBanner } from './FitMatchBanner';
import { PlanCoverCarousel } from './PlanCoverCarousel';
import { InvitePeopleSheet, type InviteProfile } from './InvitePeopleSheet';
import type { ChatGroupOption } from '../lib/inviteChatGroup';
import { listGroupsInvitedToPlan, listMyChatGroups } from '../lib/inviteChatGroup';
import { PressScale } from './PressScale';
import { ProfileAvatar } from './ProfileAvatar';
import { TranslatedText } from './TranslatedText';
import { seedUserProfilePeek, prefetchUserProfile } from '../lib/userProfileCache';
import { planCoverList } from '../lib/planCovers';
import { planIsOrganizer } from '../lib/organizer';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const SUCCESS = '#22C55E';
const JOINED_VIVID = '#10B981';
const JOINED_VIVID_BG = '#D1FAE5';
const JOINED_VIVID_BORDER = '#34D399';
const DANGER = '#EF4444';
const DANGER_DARK = '#DC2626';
const DANGER_BG = '#FEF2F2';
const GOLD = '#D4AF37';

/** Feed listContent paddingHorizontal 20 + 20 */
const COVER_W = Dimensions.get('window').width - 40;

const AVATAR_SIZE = 45;
/** Lo que cada burbuja monta sobre la anterior. */
const AVATAR_OVERLAP = 18;
const AVATAR_ADVANCE = AVATAR_SIZE - AVATAR_OVERLAP;
/** Hueco reservado al «somos N» para que no acabe en puntos suspensivos. */
const GOING_TEXT_MIN_W = 76;
/**
 * Seis avatares más el «+N», o los que quepan si el móvil es muy estrecho:
 * con un número fijo el texto de al lado se cortaba en pantallas pequeñas.
 */
const MAX_VISIBLE_AVATARS = (() => {
    const stackWidth = COVER_W - 36 - GOING_TEXT_MIN_W;
    const bubbles = Math.floor((stackWidth - AVATAR_SIZE) / AVATAR_ADVANCE) + 1;
    // `bubbles` cuenta también la del «+N», que puede estar o no.
    return Math.max(3, Math.min(6, bubbles - 1));
})();

const avatarFallback = (name?: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'N')}&background=4DA6FF&color=fff`;

/**
 * Avatar de lista servido como miniatura: una foto de 145 kB se queda en ~10 kB.
 * Si la miniatura falla, cae a la original para no dejar el hueco gris.
 */
const ListAvatar = ({
    uri,
    name,
    size,
    style,
    recyclingKey,
}: {
    uri?: string | null;
    name?: string;
    /** Lado en puntos con el que se pinta (el del estilo). */
    size: number;
    style: StyleProp<ImageStyle>;
    recyclingKey?: string;
}) => {
    const [thumbFailed, setThumbFailed] = useState(false);
    const original = uri || avatarFallback(name);
    const thumb = thumbFailed ? original : storageThumbUrl(original, size) ?? original;

    return (
        <ExpoImage
            source={thumb === original ? { uri: original } : { uri: thumb, headers: WEBP_ACCEPT_HEADERS }}
            style={style}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={recyclingKey}
            transition={0}
            onError={thumbFailed ? undefined : () => setThumbFailed(true)}
        />
    );
};

export type { Membership } from '../lib/participants';

const isSameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const AvatarStack = ({
    participants,
    joinedCount,
    onOpenRoster,
    dark,
}: {
    participants: any[];
    /** Total real de unidos; participants solo trae una muestra para los avatares. */
    joinedCount: number;
    onOpenRoster: () => void;
    dark?: boolean;
}) => {
    const { t } = useT();
    const styles = useThemedStyles(createPlanCardStyles);
    if (!participants || participants.length === 0) {
        return (
            <View style={styles.avatarStackRow}>
                <Text style={[styles.beFirstText, dark && styles.beFirstTextDark]}>{t('card.beFirst')}</Text>
            </View>
        );
    }
    const visible = participants.slice(0, MAX_VISIBLE_AVATARS);
    const total = Math.max(joinedCount || 0, participants.length);
    const extra = total - visible.length;

    return (
        <View style={styles.avatarStackRow}>
            <TouchableOpacity activeOpacity={0.85} onPress={onOpenRoster} style={styles.avatarStackTouchable}>
                <View style={styles.avatarStack}>
                    {visible.map((p, index) => (
                        <View
                            key={p.id ?? index}
                            style={[
                                styles.stackAvatarWrap,
                                {
                                    marginLeft: index === 0 ? 0 : -AVATAR_OVERLAP,
                                    zIndex: visible.length - index,
                                },
                            ]}
                        >
                            <ListAvatar
                                uri={p.avatar_url}
                                name={p.nombre}
                                size={AVATAR_SIZE}
                                style={styles.stackAvatar}
                                recyclingKey={p.id ?? p.avatar_url}
                            />
                        </View>
                    ))}
                    {extra > 0 && (
                        // Encima de todas: debajo, el último avatar le tapaba el «+».
                        <View
                            style={[
                                styles.stackAvatarWrap,
                                styles.extraBubble,
                                { marginLeft: -AVATAR_OVERLAP, zIndex: visible.length + 1 },
                            ]}
                        >
                            <Text style={styles.extraBubbleText}>+{extra}</Text>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} onPress={onOpenRoster} style={styles.goingTextWrap}>
                <Text
                    style={[styles.goingText, dark && styles.goingTextDark]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {t('card.weAre', { n: total })}
                </Text>
            </TouchableOpacity>
        </View>
    );
};

interface PlanCardProps {
    item: any;
    index: number;
    currentUserId: string | null;
    userGenero?: string | null;
    membership: Membership;
    isSaved: boolean;
    friendIds?: Set<string>;
    coincidedIds?: Set<string>;
    feedTaste?: FeedTaste | null;
    /** Solo el owner: puede eliminar cualquier plan del feed. */
    isOwner?: boolean;
    /** La cuenta que mira el feed es organizador: no puede unirse a planes de otros. */
    viewerIsOrganizer?: boolean;
    onJoin: (id: string) => void;
    joining?: boolean;
    onLeave: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onToggleSave: (id: string) => void;
    onOpenDetail?: (id: string) => void;
    onOpenProfile?: (userId: string) => void;
    onParticipantsChanged?: () => void;
    distanceLabel?: string;
    /** Animación de entrada en el feed (desactivar mejora scroll). */
    animateEntrance?: boolean;
    router: any;
}

function PlanCardInner({
    item,
    index,
    currentUserId,
    userGenero,
    membership,
    isSaved,
    friendIds,
    coincidedIds,
    feedTaste,
    isOwner,
    onJoin,
    joining = false,
    onLeave,
    onDelete,
    onEdit,
    onToggleSave,
    onOpenDetail,
    onOpenProfile,
    onParticipantsChanged,
    distanceLabel,
    viewerIsOrganizer = false,
    animateEntrance = false,
    router,
}: PlanCardProps) {
    const { t, lang } = useT();
    const { colors } = useAppTheme();
    const { isGuest } = useAuthSession();
    const styles = useThemedStyles(createPlanCardStyles);
    const [expanded, setExpanded] = useState(false);
    const [showRoster, setShowRoster] = useState(false);
    const [showInviteSheet, setShowInviteSheet] = useState(false);
    const [invitees, setInvitees] = useState<InviteProfile[]>([]);
    const [invitedGroups, setInvitedGroups] = useState<ChatGroupOption[]>([]);
    const heartHostRef = useRef<View>(null);
    const entrance = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!animateEntrance || index > 4) {
            entrance.setValue(1);
            return;
        }
        Animated.timing(entrance, {
            toValue: 1,
            duration: 320,
            delay: Math.min(index, 4) * 50,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [animateEntrance, entrance, index]);

    const isCreator = currentUserId && String(item.creador_id) === String(currentUserId);
    const isFull = item.joinedCount >= item.maximo_participantes;
    const requiresApproval = !!item.requiere_aprobacion;
    const participants = item.participantsList || [];
    const eventDate = item.fecha_evento ? new Date(item.fecha_evento) : null;
    const isToday = eventDate ? isSameCalendarDay(eventDate, new Date()) : false;
    const isPast = eventDate ? eventDate.getTime() < Date.now() : false;
    const friendParticipants =
        !viewerIsOrganizer && friendIds
            ? participants.filter((p: { id?: string }) => p.id && friendIds.has(p.id))
            : [];
    const friendsInPlan = friendParticipants.length;
    // Conocidos = coincidencia previa; no en planes ya pasados ni solapados con amigos.
    // Cuentas de comunidad: sin amigos/conocidos ni % encaja.
    const coincidedParticipants =
        !viewerIsOrganizer && !isPast && coincidedIds
            ? participants.filter(
                (p: { id?: string }) =>
                    p.id &&
                    p.id !== currentUserId &&
                    coincidedIds.has(p.id) &&
                    !(friendIds && friendIds.has(p.id)),
            )
            : [];
    const coincidedInPlan = coincidedParticipants.length;
    const friendsAllFemale = allFemaleGenero(friendParticipants);
    const coincidedAllFemale = allFemaleGenero(coincidedParticipants);
    const socialJoined =
        isCreator || viewerIsOrganizer
            ? null
            : formatSocialJoinedBanner({
                  friendsCount: friendsInPlan,
                  coincidedCount: coincidedInPlan,
                  friendsAllFemale,
                  coincidedAllFemale,
                  t,
              });
    const fitPct =
        !viewerIsOrganizer && !isCreator && !socialJoined && feedTaste && currentUserId
            ? feedFitPercent(
                  {
                      categoria: item.categoria,
                      tipo_deporte: item.tipo_deporte,
                      fecha_evento: item.fecha_evento,
                      solo_chicas: item.solo_chicas,
                  },
                  {
                      personalityTags: feedTaste.personalityTags,
                      viewerAge: feedTaste.viewerAge,
                      viewerGenero: userGenero,
                  },
                  item.id,
              )
            : null;

    const isSoloChicas = isSoloChicasPlan(item);
    const isFriendsOnly = !!item.solo_amigos && !item.modo_privado;
    const isPrivate = !!item.modo_privado;
    const canInvite = isCreator && isPrivate && !isPast;
    const genderBlocked = !canJoinPlanByGender(item, userGenero as any);
    const isOrganizerPlan = planIsOrganizer(item);
    const coverList = planCoverList(item);
    const isCalmPremium = !isToday && !isFull && !isSoloChicas && !isFriendsOnly && !isPrivate;
    const dateLocale = localeTag(lang);
    const dateString = eventDate
        ? (() => {
              const raw = eventDate.toLocaleDateString(dateLocale, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
              });
              const cleaned = raw.replace(/\./g, '');
              return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
          })()
        : t('card.noDate');
    const timeString = eventDate
        ? eventDate.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
        : '';

    const openDetail = () => {
        if (onOpenDetail) {
            onOpenDetail(item.id);
            return;
        }
        setExpanded(prev => !prev);
    };
    const pressIn = () => {
        Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
        // Empieza a calentar detalle + torneo mientras baja el dedo.
        const pid = String(item.id);
        prefetchPlanDetail(pid);
        if (resolvePlanSport(item)?.tipo === 'futbol') {
            // Torneo del feed: force refresh si ya lo conocemos (plan clave).
            prioritizeTournamentPrefetch(pid);
        }
    };
    const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

    const creator = item.host
        || participants.find((p: { isCreator?: boolean }) => p.isCreator)
        || (!isOrganizerPlan ? participants[0] : null);
    // Una sola etiqueta especial en la card (menos ruido visual).
    const specialTag: 'private' | 'friends' | 'soloChicas' | null = isPrivate
        ? 'private'
        : isFriendsOnly
          ? 'friends'
          : isSoloChicas
            ? 'soloChicas'
            : null;

    const handleShare = () => {
        hapticLight();
        void (async () => {
            const planId = String(item.id);
            const torneo = await fetchTournamentConfig(planId);
            if (torneo) {
                requestTournamentShare(planId);
                return;
            }
            await sharePlanLink(planId, item.titulo);
        })();
    };

    const loadInviteState = useCallback(async () => {
        if (!canInvite || !currentUserId) {
            setInvitees([]);
            setInvitedGroups([]);
            return;
        }
        const planId = String(item.id);
        try {
            const list = await getPlanPendingInvitees(planId);
            setInvitees(
                list.map((i) => ({
                    id: i.id,
                    nombre: i.nombre,
                    nombre_usuario: i.nombre_usuario,
                    avatar_url: i.avatar_url,
                    invitedByName: i.invitadorNombre,
                })),
            );
        } catch {
            setInvitees([]);
        }
        try {
            const groups = await listMyChatGroups(currentUserId);
            const already = await listGroupsInvitedToPlan(
                planId,
                groups.map((g) => g.id),
            );
            setInvitedGroups(
                already.map((g) => {
                    const full = groups.find((r) => r.id === g.id);
                    return full ?? g;
                }),
            );
        } catch {
            setInvitedGroups([]);
        }
    }, [canInvite, currentUserId, item.id]);

    useEffect(() => {
        void loadInviteState();
    }, [loadInviteState]);

    const openInviteSheet = () => {
        setShowInviteSheet(true);
        void loadInviteState();
    };

    const handleInviteAdd = useCallback(
        async (profile: InviteProfile) => {
            if (!currentUserId) return { error: 'no_user' };
            const { error } = await sendPlanInvite(String(item.id), currentUserId, profile.id, 'plan');
            if (!error) {
                setInvitees((prev) => (prev.some((p) => p.id === profile.id) ? prev : [...prev, profile]));
            }
            return { error };
        },
        [currentUserId, item.id],
    );

    const handleInviteRemove = useCallback(
        async (profileId: string) => {
            const { error } = await cancelPlanInvite(String(item.id), profileId);
            if (!error) {
                setInvitees((prev) => prev.filter((p) => p.id !== profileId));
            }
            return { error };
        },
        [item.id],
    );

    const memberExcludeIds = useMemo(() => {
        const list = item.participantsList || [];
        return new Set(list.map((p: { id?: string }) => p.id).filter(Boolean) as string[]);
    }, [item.participantsList]);

    const renderFooter = () => {
        if (isCreator) {
            return (
                <View style={styles.creatorFooterRow}>
                    <TouchableOpacity style={[styles.iconActionBtn, { backgroundColor: PRIMARY }]} onPress={() => onEdit(item.id)}>
                        <Ionicons name="create" size={18} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.iconActionBtn, { backgroundColor: DANGER }]} onPress={() => onDelete(item.id)}>
                        <Ionicons name="trash" size={18} color="#FFF" />
                    </TouchableOpacity>
                </View>
            );
        }
        if (viewerIsOrganizer) {
            return (
                <View style={styles.organizerBlockedRow}>
                    <Ionicons name="briefcase-outline" size={18} color={PRIMARY_DARK} />
                    <Text style={styles.organizerBlockedText}>{t('organizer.cannotJoinHint')}</Text>
                </View>
            );
        }
        if (membership === 'requested') {
            return (
                <TouchableOpacity
                    style={styles.requestedButton}
                    activeOpacity={0.88}
                    onPress={() => {
                        hapticSelection();
                        onLeave(item.id);
                    }}
                >
                    <Ionicons name="time" size={18} color="#B45309" />
                    <Text style={styles.requestedButtonText}>{t('card.requested')}</Text>
                </TouchableOpacity>
            );
        }
        if (membership === 'joined') {
            return (
                <TouchableOpacity
                    style={styles.joinedButton}
                    activeOpacity={0.88}
                    onPress={() => {
                        hapticSelection();
                        onLeave(item.id);
                    }}
                >
                    <Ionicons name="checkmark-circle" size={18} color={JOINED_VIVID} />
                    <Text style={styles.joinedButtonText}>
                        {t(userGenero === 'femenino' ? 'card.joinedF' : 'card.joined')}
                    </Text>
                </TouchableOpacity>
            );
        }
        if (membership === 'waitlist') {
            return (
                <TouchableOpacity
                    style={styles.waitlistButton}
                    activeOpacity={0.88}
                    onPress={() => {
                        hapticSelection();
                        onLeave(item.id);
                    }}
                >
                    <Ionicons name="hourglass" size={18} color="#7C3AED" />
                    <Text style={styles.waitlistButtonText}>{t('card.waitlist')}</Text>
                </TouchableOpacity>
            );
        }
        if (genderBlocked) {
            return (
                <View style={styles.genderBlockedRow}>
                    <Ionicons name="lock-closed" size={18} color="#DB2777" />
                    <Text style={styles.genderBlockedText}>{t('card.soloChicasOnly')}</Text>
                </View>
            );
        }
        if (isFull) {
            if (!canJoinWaitlist(item.fecha_evento)) {
                return (
                    <View style={styles.fullClosedRow}>
                        <Ionicons name="ban" size={18} color={DANGER_DARK} />
                        <Text style={styles.fullClosedText}>{t('card.fullClosed')}</Text>
                    </View>
                );
            }
            return (
                <TouchableOpacity
                    style={[styles.waitlistJoinButton, joining && { opacity: 0.55 }]}
                    activeOpacity={0.88}
                    disabled={joining}
                    onPress={() => {
                        if (joining) return;
                        hapticMedium();
                        onJoin(item.id);
                    }}
                >
                    <Ionicons name="list" size={18} color="#FFF" />
                    <Text style={styles.waitlistJoinText}>{t('card.joinWaitlist')}</Text>
                </TouchableOpacity>
            );
        }
        return (
            <TouchableOpacity
                style={[styles.joinButton, joining && { opacity: 0.55 }]}
                activeOpacity={0.88}
                disabled={joining}
                onPress={() => {
                    if (joining) return;
                    hapticMedium();
                    onJoin(item.id);
                }}
            >
                <Text style={styles.joinButtonText}>{requiresApproval ? t('card.request') : t('card.join')}</Text>
            </TouchableOpacity>
        );
    };

    return (
        <Animated.View style={{ opacity: entrance, transform: [{ scale }, { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
            <View style={[
                        styles.card,
                        { backgroundColor: colors.surface },
                    isToday && styles.cardToday,
                    isSoloChicas && styles.cardSoloChicas,
                    isFriendsOnly && styles.cardFriends,
                    isPrivate && styles.cardPrivate,
                    isCalmPremium && styles.cardPremium,
                    isFull && !isToday && !isSoloChicas && !isFriendsOnly && !isPrivate && styles.cardFull,
                ]}>
                    {isToday && (
                        <LinearGradient
                            colors={['#F59E0B', '#D97706', '#B45309']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.todayBorder}
                        />
                    )}
                    {isSoloChicas && (
                        <LinearGradient
                            colors={['#F9A8D4', '#EC4899', '#DB2777']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.soloChicasBorder}
                        />
                    )}
                    {isFriendsOnly && (
                        <LinearGradient
                            colors={['#86EFAC', '#22C55E', '#15803D']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.friendsBorder}
                        />
                    )}
                    {isPrivate && (
                        <LinearGradient
                            colors={['#475569', '#1E293B', '#020617']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.privateBorder}
                        />
                    )}
                    {isCalmPremium && (
                        <LinearGradient
                            colors={['#BFDBFE', '#93C5FD', '#60A5FA']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.premiumBorder}
                        />
                    )}
                    {isFull && !isToday && (
                        <LinearGradient
                            colors={['#FCA5A5', '#EF4444', '#B91C1C']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.fullBorder}
                        />
                    )}
                    <View style={[
                        styles.cardInner,
                        isToday && styles.cardInnerToday,
                        isSoloChicas && styles.cardInnerSoloChicas,
                        isFriendsOnly && styles.cardInnerFriends,
                        isPrivate && styles.cardInnerPrivate,
                        isCalmPremium && styles.cardInnerPremium,
                        isFull && styles.cardInnerFull,
                    ]}>
                    <View style={styles.imageWrap} pointerEvents="box-none">
                        <PlanCoverCarousel
                            covers={coverList}
                            fallback={item.imagen_url}
                            height={222}
                            width={COVER_W}
                            recyclingKey={String(item.id)}
                            priority={index < 3 ? 'high' : 'normal'}
                            deferExtraSlides
                            thumbWidth={720}
                            onPress={onOpenDetail ? () => onOpenDetail(item.id) : openDetail}
                        />
                        <LinearGradient
                            pointerEvents="none"
                            colors={
                                isPrivate
                                    ? ['rgba(15,23,42,0)', 'rgba(15,23,42,0)', 'rgba(15,23,42,0.5)']
                                    : isFriendsOnly
                                      ? ['rgba(21,128,61,0)', 'rgba(21,128,61,0)', 'rgba(21,128,61,0.32)']
                                      : isToday
                                        ? ['rgba(180,83,9,0)', 'rgba(180,83,9,0)', 'rgba(120,53,15,0.7)']
                                        : ['rgba(15,42,74,0)', 'rgba(15,42,74,0)', 'rgba(15,42,74,0.58)']
                            }
                            locations={[0, 0.42, 1]}
                            style={styles.imageShade}
                        />
                        {isFull && <View pointerEvents="none" style={styles.fullVeil} />}
                        {isFull && (
                            <View style={styles.fullBadgeTop} pointerEvents="none">
                                <Ionicons name="ban" size={12} color="#FFF" />
                                <Text style={styles.fullBadgeTopText}>{t('card.fullShort')}</Text>
                            </View>
                        )}
                        {isToday && !isFull && (
                            <View style={styles.todayBadge} pointerEvents="none">
                                <Text style={styles.todayBadgeText}>{t('card.todayBadge')}</Text>
                            </View>
                        )}

                        <View style={styles.topRow} pointerEvents="box-none">
                            <View style={styles.topLeftTags} pointerEvents="none">
                                {specialTag === 'soloChicas' ? (
                                    <View style={styles.soloChicasTag}>
                                        <Ionicons name="female" size={11} color="#FFF" />
                                        <Text style={styles.soloChicasTagText}>{t('createplan.soloChicasTitle')}</Text>
                                    </View>
                                ) : null}
                                {specialTag === 'friends' ? (
                                    <View style={styles.friendsOnlyTag}>
                                        <Ionicons name="people" size={11} color="#FFF" />
                                        <Text style={styles.friendsOnlyTagText}>{t('createplan.friendsOnlyTitle')}</Text>
                                    </View>
                                ) : null}
                                {specialTag === 'private' ? (
                                    <View style={styles.privateTag}>
                                        <Ionicons name="lock-closed" size={11} color="#FFF" />
                                        <Text style={styles.privateTagText}>{t('card.privateTag')}</Text>
                                    </View>
                                ) : null}
                            </View>
                            <View style={styles.topRightGroup}>
                                <PressScale
                                    style={styles.shareBtnOnImage}
                                    pressedScale={0.88}
                                    minTouch={false}
                                    onPress={(e) => {
                                        e.stopPropagation();
                                        handleShare();
                                    }}
                                    accessibilityLabel={t('card.share')}
                                >
                                    <Ionicons
                                        name="share-outline"
                                        size={26}
                                        color="#FFFFFF"
                                        style={styles.iconOnImage}
                                    />
                                </PressScale>
                                <View ref={heartHostRef} style={styles.heartHost} collapsable={false}>
                                    <BounceHeart
                                        saved={isSaved}
                                        size={26}
                                        iconStyle={styles.iconOnImage}
                                        onPress={() => {
                                            if (!isSaved && !isGuest) {
                                                requestAnimationFrame(() => {
                                                    heartHostRef.current?.measureInWindow((x, y, w, h) => {
                                                        emitHeartBurst(x + w / 2, y + h / 2);
                                                    });
                                                });
                                            }
                                            onToggleSave(item.id);
                                        }}
                                    />
                                </View>
                            </View>
                        </View>

                        <View style={styles.imageBottomRow} pointerEvents="none">
                            <View style={{ flex: 1 }}>
                                <TranslatedText
                                    text={item.titulo}
                                    style={styles.cardTitleOnImage}
                                    numberOfLines={2}
                                    showHint={false}
                                />
                            </View>
                        </View>
                    </View>

                    <Pressable onPressIn={pressIn} onPressOut={pressOut} onPress={onOpenDetail ? () => onOpenDetail(item.id) : openDetail}>
                    <View style={[
                        styles.cardContent,
                        isToday && styles.cardContentToday,
                        isSoloChicas && styles.cardContentSoloChicas,
                        isFriendsOnly && styles.cardContentFriends,
                        isPrivate && styles.cardContentPrivate,
                        isCalmPremium && styles.cardContentPremium,
                        isFull && styles.cardContentFull,
                    ]}>
                        <AvatarStack
                            participants={participants}
                            joinedCount={Number(item.joinedCount) || 0}
                            onOpenRoster={() => {
                                if (onOpenDetail) onOpenDetail(item.id);
                                else if (participants.length > 0) setShowRoster(true);
                            }}
                        />

                        {socialJoined ? (
                            <Text style={styles.socialJoinedLine}>
                                {socialJoined.friends && socialJoined.coincided ? (
                                    <>
                                        <Text style={styles.socialJoinedBold}>{socialJoined.friends}</Text>
                                        {` ${t('card.socialJoinedAnd')} `}
                                        <Text style={styles.socialJoinedBold}>{socialJoined.coincided}</Text>
                                        {` ${t('card.socialJoinedInPlan')}`}
                                    </>
                                ) : (
                                    <>
                                        <Text style={styles.socialJoinedBold}>
                                            {socialJoined.friends ?? socialJoined.coincided}
                                        </Text>
                                        {` ${t('card.socialJoinedInPlan')}`}
                                    </>
                                )}
                            </Text>
                        ) : fitPct != null ? (
                            <FitMatchBanner
                                pct={fitPct}
                                label={t('card.fitMatch', { pct: fitPct })}
                                compact
                            />
                        ) : null}

                        <View style={styles.metaRow}>
                            <View style={[styles.metaItem, styles.metaItemDate]}>
                                <Ionicons
                                    name="calendar-outline"
                                    size={15}
                                    color={isPrivate ? colors.text : isFriendsOnly ? '#15803D' : isToday ? '#B45309' : PRIMARY_DARK}
                                />
                                <Text style={[
                                    styles.metaText,
                                    isToday && styles.metaTextToday,
                                    isFriendsOnly && styles.metaTextFriends,
                                    isPrivate && styles.metaTextPrivate,
                                ]} numberOfLines={1}>
                                    {dateString}{timeString ? ` · ${timeString}` : ''}
                                </Text>
                            </View>
                            <View style={[styles.metaItem, styles.metaItemLoc]}>
                                <Ionicons
                                    name="location-outline"
                                    size={15}
                                    color={isPrivate ? colors.text : isFriendsOnly ? '#15803D' : PRIMARY_DARK}
                                />
                                <Text style={[
                                    styles.metaText,
                                    styles.metaTextLoc,
                                    isFriendsOnly && styles.metaTextFriends,
                                    isPrivate && styles.metaTextPrivate,
                                ]} numberOfLines={1} ellipsizeMode="tail">
                                    {(() => {
                                        const place =
                                            typeof item.nombre_ubicacion === 'string'
                                                ? item.nombre_ubicacion.trim()
                                                : '';
                                        const hasCoords =
                                            item.latitud != null &&
                                            item.longitud != null &&
                                            item.latitud !== '' &&
                                            item.longitud !== '' &&
                                            Number.isFinite(Number(item.latitud)) &&
                                            Number.isFinite(Number(item.longitud));
                                        if (distanceLabel && hasCoords) return distanceLabel;
                                        if (place) return place;
                                        return t('createplan.tbd');
                                    })()}
                                </Text>
                            </View>
                        </View>

                        {(() => {
                            const sport = resolvePlanSport(item);
                            if (sport?.tipo !== 'futbol' && sport?.tipo !== 'padel') return null;
                            return (
                            <TouchableOpacity
                                style={styles.futbolChip}
                                activeOpacity={0.88}
                                onPress={() => {
                                    hapticSelection();
                                    if (onOpenDetail) onOpenDetail(item.id);
                                    else router.push(`/plan/${item.id}`);
                                }}
                            >
                                <View style={styles.futbolBall}>
                                    <Ionicons
                                        name={sport.tipo === 'padel' ? 'tennisball' : 'football'}
                                        size={18}
                                        color="#FFF"
                                    />
                                </View>
                                <Text style={styles.futbolFormatText}>{t('card.lineups')}</Text>
                                <Text style={styles.futbolChipHint} numberOfLines={1}>
                                    {t('card.lineupsHint')}
                                </Text>
                                <Ionicons name="chevron-forward" size={18} color="#1B7A42" />
                            </TouchableOpacity>
                            );
                        })()}

                        {expanded && !onOpenDetail && (
                            <View style={styles.expandedSection}>
                                <Text style={[styles.descLabel, isPrivate && styles.descLabelPrivate]}>{t('card.aboutPlan')}</Text>
                                <TranslatedText
                                    text={item.descripcion?.trim() || null}
                                    empty={t('card.noDescription')}
                                    style={[styles.descriptionText, isPrivate && styles.descriptionTextPrivate]}
                                    showHint={false}
                                />
                                <View style={styles.miniMapContainer}>
                                    <NexoMapView
                                        key={`mini-${item.id}-${item.latitud}-${item.longitud}`}
                                        style={styles.miniMap}
                                        scrollEnabled={false}
                                        zoomEnabled={false}
                                        pitchEnabled={false}
                                        rotateEnabled={false}
                                        liteMode={Platform.OS === 'android'}
                                        loadingEnabled
                                        moveOnMarkerPress={false}
                                        initialRegion={{
                                            latitude: item.latitud || 40.4167,
                                            longitude: item.longitud || -3.7037,
                                            latitudeDelta: 0.005,
                                            longitudeDelta: 0.005,
                                        }}
                                    >
                                        <Marker
                                            coordinate={{
                                                latitude: item.latitud || 40.4167,
                                                longitude: item.longitud || -3.7037,
                                            }}
                                        />
                                    </NexoMapView>
                                </View>
                            </View>
                        )}

                        <View style={styles.cardFooter}>
                            <View style={styles.footerRow}>
                                {creator?.nombre ? (
                                    <TouchableOpacity
                                        style={styles.footerHost}
                                        activeOpacity={0.85}
                                        onPress={() => {
                                            if (!creator.id) return;
                                            seedUserProfilePeek({
                                                id: creator.id,
                                                nombre: creator.nombre,
                                                avatar_url: creator.avatar_url,
                                                es_organizador: planIsOrganizer(item) || creator.es_organizador === true,
                                            });
                                            prefetchUserProfile(creator.id);
                                            if (onOpenProfile) onOpenProfile(creator.id);
                                            else router.push(`/user-profile/${creator.id}`);
                                        }}
                                    >
                                        <ProfileAvatar
                                            uri={creator.avatar_url}
                                            name={creator.nombre}
                                            size={36}
                                            recyclingKey={creator.id}
                                        />
                                        <Text style={styles.footerHostText} numberOfLines={1}>
                                            <Text style={styles.footerHostPrefix}>{t('card.hostedByPrefix')} </Text>
                                            <Text style={styles.footerHostName}>{creator.nombre}</Text>
                                        </Text>
                                    </TouchableOpacity>
                                ) : (
                                    <View style={styles.footerHostSpacer} />
                                )}
                                <View style={styles.footerAction}>
                                    {renderFooter()}
                                </View>
                            </View>
                            {canInvite ? (
                                <TouchableOpacity style={styles.creatorInviteBtn} onPress={openInviteSheet} activeOpacity={0.85}>
                                    <Ionicons name="person-add" size={18} color="#FFF" />
                                    <Text style={styles.creatorInviteBtnText}>{t('card.invite')}</Text>
                                </TouchableOpacity>
                            ) : null}
                            {isOwner && !isCreator ? (
                                <TouchableOpacity
                                    style={styles.ownerDeleteBtn}
                                    onPress={() => onDelete(item.id)}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="trash" size={16} color="#FFF" />
                                    <Text style={styles.ownerDeleteBtnText}>{t('admin.deletePlanConfirm')}</Text>
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    </View>
                    </Pressable>
                    </View>
                </View>

            <Modal visible={showRoster} transparent animationType="fade" onRequestClose={() => setShowRoster(false)}>
                <Pressable style={styles.rosterOverlay} onPress={() => setShowRoster(false)}>
                    <Pressable style={styles.rosterSheet} onPress={(e) => e.stopPropagation()}>
                        <View style={styles.rosterHandle} />
                        <Text style={styles.rosterTitle}>
                            {t('card.participants')} · {Math.max(Number(item.joinedCount) || 0, participants.length)}
                        </Text>
                        {participants.map((p: any) => (
                            <View key={p.id} style={styles.rosterRowWrap}>
                                <TouchableOpacity
                                    style={[styles.rosterRow, { flex: 1 }]}
                                    activeOpacity={0.8}
                                    onPress={() => {
                                        setShowRoster(false);
                                        seedUserProfilePeek({
                                            id: p.id,
                                            nombre: p.nombre,
                                            avatar_url: p.avatar_url,
                                            es_organizador: p.es_organizador === true,
                                        });
                                        prefetchUserProfile(p.id);
                                        if (onOpenProfile) onOpenProfile(p.id);
                                        else {
                                            router.push({
                                                pathname: '/user-profile/[id]',
                                                params: { id: p.id },
                                            });
                                        }
                                    }}
                                >
                                    <ListAvatar
                                        uri={p.avatar_url}
                                        name={p.nombre}
                                        size={44}
                                        style={[styles.rosterAvatar, p.isCreator && styles.stackAvatarCreator]}
                                        recyclingKey={p.id ?? p.avatar_url}
                                    />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.rosterName}>{p.nombre || t('profile.user')}</Text>
                                        {p.isCreator && (
                                            <Text style={styles.rosterCreatorLabel}>
                                                {t(p.genero === 'femenino' ? 'chat.hostF' : 'chat.host')}
                                            </Text>
                                        )}
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                                </TouchableOpacity>
                                {isCreator && !p.isCreator && currentUserId && (
                                    <TouchableOpacity
                                        style={styles.rosterKickBtn}
                                        onPress={() => {
                                            const targetId = p.id as string;
                                            const targetName = p.nombre || t('profile.user');
                                            setShowRoster(false);
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
                                                                        item.id,
                                                                        targetId,
                                                                        currentUserId,
                                                                    );
                                                                    if (error) Alert.alert(t('feed.error'), error);
                                                                    else onParticipantsChanged?.();
                                                                })();
                                                            },
                                                        },
                                                    ],
                                                );
                                            }, 250);
                                        }}
                                    >
                                        <Ionicons name="ban-outline" size={20} color={DANGER} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        ))}
                    </Pressable>
                </Pressable>
            </Modal>

            {canInvite ? (
                <InvitePeopleSheet
                    visible={showInviteSheet}
                    onClose={() => setShowInviteSheet(false)}
                    currentUserId={currentUserId}
                    selected={invitees}
                    selectedGroups={invitedGroups}
                    excludeIds={memberExcludeIds}
                    targetPlanId={String(item.id)}
                    onAdd={handleInviteAdd}
                    onRemove={handleInviteRemove}
                    onGroupInvited={(group) => {
                        setInvitedGroups((prev) =>
                            prev.some((g) => g.id === group.id) ? prev : [...prev, group],
                        );
                        void loadInviteState();
                    }}
                />
            ) : null}
        </Animated.View>
    );
}

function createPlanCardStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY = c.brand;
    const PRIMARY_DARK = c.primary;
    const SUCCESS = c.success;
    const DANGER = c.danger;
    const DANGER_DARK = c.dangerDark;
    const DANGER_BG = c.dangerSoft;
    const isDark = c.statusBar === 'light';
    return StyleSheet.create({
    card: { borderRadius: 26, marginBottom: 22, overflow: 'hidden', elevation: 10, shadowColor: isDark ? '#000' : '#1E3A8A', shadowOpacity: isDark ? 0.45 : 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, backgroundColor: c.surface },
    cardFull: { padding: 3, overflow: 'visible', elevation: 10, shadowColor: DANGER_DARK, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, borderRadius: 28 },
    fullBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerFull: { borderColor: DANGER, borderWidth: 2, backgroundColor: 'transparent' },
    cardToday: { padding: 3, overflow: 'visible', elevation: 10, shadowColor: '#D97706', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, borderRadius: 28 },
    cardSoloChicas: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#DB2777', shadowOpacity: 0.35, borderRadius: 28 },
    soloChicasBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerSoloChicas: { backgroundColor: 'transparent', borderColor: isDark ? '#9D174D' : '#F9A8D4', borderWidth: 2 },
    cardFriends: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#16A34A', shadowOpacity: 0.32, borderRadius: 28 },
    friendsBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerFriends: { backgroundColor: 'transparent', borderColor: isDark ? '#166534' : '#86EFAC', borderWidth: 2 },
    cardPrivate: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#020617', shadowOpacity: 0.45, borderRadius: 28 },
    privateBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerPrivate: { backgroundColor: 'transparent', borderColor: isDark ? c.borderStrong : '#64748B', borderWidth: 2 },
    cardContentFriends: { backgroundColor: isDark ? c.successSoft : '#FAFDFB' },
    cardContentPrivate: { backgroundColor: isDark ? c.surfaceSubtle : '#EEF2F7' },
    cardContentToday: { backgroundColor: c.warningSoft },
    cardContentSoloChicas: { backgroundColor: isDark ? '#3B1120' : '#FDF2F8' },
    cardContentPremium: { backgroundColor: isDark ? c.surface : '#FAFCFF' },
    cardContentFull: { backgroundColor: DANGER_BG },
    friendsOnlyTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(22,163,74,0.92)',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 10,
    },
    friendsOnlyTagText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
    privateTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(15,23,42,0.92)',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.35)',
    },
    privateTagText: { color: '#F8FAFC', fontSize: 9, fontWeight: '800' },
    metaTextFriends: { color: isDark ? c.success : '#166534', fontWeight: '700' },
    metaTextPrivate: { color: c.text, fontWeight: '800' },
    friendsBannerOnFriends: { backgroundColor: isDark ? c.successSoft : '#F0FDF4', borderColor: isDark ? '#166534' : '#BBF7D0' },
    friendsBannerTextFriends: { color: isDark ? c.success : '#15803D' },
    friendsBannerOnPrivate: { backgroundColor: isDark ? c.primarySoft : '#E0E7FF', borderColor: isDark ? c.primaryBorder : '#A5B4FC' },
    friendsBannerTextPrivate: { color: isDark ? c.brand : '#3730A3' },
    coincidedBannerOnPrivate: { backgroundColor: c.primarySoft, borderColor: c.primaryBorder },
    expandHintTextPrivate: { color: c.text, fontWeight: '800' },
    descLabelPrivate: { color: c.text },
    descriptionTextPrivate: { color: c.textMuted },
    cardPremium: { padding: 2, overflow: 'visible', elevation: 12, shadowColor: '#2563EB', shadowOpacity: 0.2, borderRadius: 28 },
    cardOrganizer: {
        padding: 3,
        overflow: 'visible',
        elevation: 10,
        shadowColor: '#C9A227',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 7 },
        borderRadius: 28,
    },
    organizerBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerOrganizer: { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0 },
    imageWrapOrganizer: { height: 222 },
    cardContentOrganizer: { backgroundColor: isDark ? '#1C1910' : '#FFFDF8' },
    orgHostText: { color: isDark ? '#F5D76E' : '#7A5A12', fontWeight: '800' },
    orgBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(255,248,232,0.96)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(201,162,39,0.45)',
    },
    orgBadgeText: { color: isDark ? '#F5D76E' : '#7A5A12', fontSize: 10, fontWeight: '800' },
    mainCategoryTagOrg: { backgroundColor: 'rgba(245,215,142,0.95)' },
    mainCategoryTextOrg: { color: isDark ? '#F5D76E' : '#7A5A12' },
    subCategoryTagOrg: { backgroundColor: isDark ? 'rgba(28,25,16,0.94)' : 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: 'rgba(201,162,39,0.35)' },
    subCategoryTextOrg: { color: isDark ? c.textMuted : '#334155' },
    todayBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    premiumBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInner: { borderRadius: 24, overflow: 'hidden', backgroundColor: 'transparent', borderWidth: 2, borderColor: isDark ? c.borderStrong : 'rgba(37,99,235,0.22)' },
    cardInnerToday: { backgroundColor: 'transparent', borderColor: c.warning, borderWidth: 2 },
    cardInnerPremium: { backgroundColor: 'transparent', borderColor: isDark ? c.primaryBorder : 'rgba(37,99,235,0.38)', borderWidth: 2 },
    todayBadge: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D97706', paddingHorizontal: 13, paddingVertical: 5, borderRadius: 18, zIndex: 5, elevation: 4, shadowColor: '#92400E', shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    todayBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
    todayBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.warningSoft, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.warning },
    todayBannerText: { color: isDark ? c.warning : '#B45309', fontWeight: '800', fontSize: 14 },
    metaTextToday: { color: isDark ? c.warning : '#B45309', fontWeight: '800' },
    metaTextOrganizer: { color: isDark ? '#F5D76E' : '#8A6D1A', fontWeight: '700' },
    avatarStackTouchable: { flexDirection: 'row', alignItems: 'center' },
    rosterOverlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
    rosterSheet: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 28, maxHeight: '55%' },
    rosterHandle: { width: 40, height: 4, backgroundColor: c.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 14 },
    rosterTitle: { fontSize: 16, fontWeight: '900', color: INK, marginBottom: 12 },
    rosterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rosterRowWrap: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rosterKickBtn: { padding: 10 },
    rosterAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: c.surfaceSubtle },
    rosterName: { fontSize: 16, fontWeight: '700', color: INK },
    rosterCreatorLabel: { fontSize: 11, fontWeight: '700', color: '#B45309', marginTop: 2 },
    imageWrap: { width: COVER_W, height: 222, position: 'relative', overflow: 'hidden' },
    cardImage: { width: '100%', height: '100%' },
    imageShade: { ...StyleSheet.absoluteFillObject },
    fullVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(185,28,28,0.18)' },
    topRow: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 4 },
    topLeftTags: { flexDirection: 'column', alignItems: 'flex-start', gap: 5, flexShrink: 1, maxWidth: '62%' },
    topRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    shareBtnOnImage: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
    },
    iconOnImage: {
        textShadowColor: 'rgba(0,0,0,0.65)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    mainCategoryTag: {
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
    },
    mainCategoryText: {
        color: PRIMARY_DARK,
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    subCategoryTag: {
        backgroundColor: 'rgba(255,255,255,0.88)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
    },
    subCategoryText: { color: INK, fontSize: 11, fontWeight: '700' },
    soloChicasTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(219,39,119,0.92)',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 10,
    },
    soloChicasTagText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
    circleBtn: { backgroundColor: 'rgba(15,42,74,0.4)', width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    heartHost: { width: 36, height: 36, overflow: 'visible', alignItems: 'center', justifyContent: 'center' },
    fullBadgeTop: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: DANGER_DARK, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 18, zIndex: 5, elevation: 4, shadowColor: DANGER_DARK, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    fullBadgeTopText: { color: '#FFF', fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
    imageBottomRow: { position: 'absolute', left: 16, right: 16, bottom: 22, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    cardTitleOnImage: { flex: 1, color: '#FFF', fontSize: 24, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },

    cardContent: {
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 16,
        marginTop: -16,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        backgroundColor: c.surface,
        zIndex: 2,
    },
    avatarStackRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    avatarStack: { flexDirection: 'row', alignItems: 'center' },
    stackAvatarWrap: { position: 'relative' },
    stackAvatar: { width: 45, height: 45, borderRadius: 23, borderWidth: 2, borderColor: c.surface, backgroundColor: c.surfaceSubtle },
    stackAvatarCreator: { borderColor: GOLD },
    creatorDot: { position: 'absolute', bottom: -1, right: -1, backgroundColor: GOLD, borderRadius: 6, width: 13, height: 13, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FFF' },
    extraBubble: { width: 45, height: 45, borderRadius: 23, borderWidth: 2, borderColor: c.surface, backgroundColor: PRIMARY_DARK, justifyContent: 'center', alignItems: 'center' },
    extraBubbleText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
    /** flexShrink: el “· máx N” va en la misma línea aunque el nombre sea largo. */
    goingTextWrap: { flexShrink: 1, marginLeft: 10 },
    goingText: { fontSize: 13, fontWeight: '800', color: INK },
    goingTextDark: { color: '#F1F5F9' },
    maxText: { fontSize: 13, fontWeight: '700', color: '#94A3B8' },
    maxTextDark: { color: '#CBD5E1' },
    beFirstText: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
    beFirstTextDark: { color: '#CBD5E1' },

    futbolChip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, backgroundColor: isDark ? c.successSoft : '#EAF3E9', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: isDark ? '#14532D' : '#CDE7CB' },
    futbolBall: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2E9E5B', justifyContent: 'center', alignItems: 'center' },
    futbolFormatText: { fontSize: 16, fontWeight: '900', color: isDark ? c.success : '#1B7A42' },
    futbolChipHint: { flex: 1, fontSize: 13, fontWeight: '700', color: isDark ? c.success : '#3E7A52' },
    fieldModal: { flex: 1, backgroundColor: c.backgroundAlt },
    fieldModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    fieldCloseBtn: { width: 44, height: 44, borderRadius: 15, backgroundColor: c.surfaceSubtle, justifyContent: 'center', alignItems: 'center' },
    fieldModalTitle: { fontSize: 18, fontWeight: '900', color: INK },
    fieldModalSub: { fontSize: 13, fontWeight: '600', color: c.textMuted },
    fieldModalBody: { flex: 1, padding: 18 },
    fieldModalHint: { textAlign: 'center', color: c.textMuted, fontWeight: '600', fontSize: 13, marginTop: 14 },
    hostRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    hostText: { fontSize: 13, fontWeight: '700', color: c.text },
    hostTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    hostTag: {
        backgroundColor: c.primarySoft,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    hostTagText: { fontSize: 11, fontWeight: '700', color: PRIMARY_DARK, maxWidth: 120 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
    metaItem: { flexDirection: 'row', alignItems: 'center' },
    metaItemDate: { flexShrink: 1, minWidth: 0 },
    metaItemLoc: { flexShrink: 1, flexGrow: 1, minWidth: 0, maxWidth: '48%' },
    metaText: { marginLeft: 7, fontSize: 14, color: c.textMuted, fontWeight: '600', flexShrink: 1 },
    metaTextLoc: { marginLeft: 4, flexShrink: 1, minWidth: 0 },

    expandedSection: { marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    descLabel: { fontSize: 11, fontWeight: '800', color: c.textSubtle, textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.3 },
    descriptionText: { fontSize: 14, color: c.textMuted, lineHeight: 21 },
    miniMapContainer: { height: 180, width: '100%', borderRadius: 16, overflow: 'hidden', marginTop: 14, borderWidth: 1, borderColor: c.border },
    miniMap: { flex: 1 },
    expandHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12 },
    expandHintText: { fontSize: 12, color: c.textSubtle, fontWeight: '600' },

    cardFooter: { marginTop: 12, gap: 8 },
    footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    footerHost: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
    footerHostSpacer: { flex: 1 },
    footerHostText: { flex: 1, minWidth: 0, fontSize: 13, color: c.text, lineHeight: 17 },
    footerHostPrefix: { fontWeight: '500', color: c.textMuted },
    footerHostName: { fontWeight: '800', color: c.text },
    footerAction: { flexShrink: 0, maxWidth: '56%', alignItems: 'flex-end' },
    creatorFooterCol: { gap: 8, alignItems: 'flex-end' },
    creatorFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    ownerDeleteBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 16,
        backgroundColor: DANGER,
    },
    ownerDeleteBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
    joinButton: {
        backgroundColor: '#1D4ED8',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 14,
        minWidth: 118,
        shadowColor: '#1E3A8A',
        shadowOpacity: isDark ? 0.35 : 0.28,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
    },
    joinButtonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    requestHint: { fontSize: 12, fontWeight: '600', color: c.textMuted, textAlign: 'center', lineHeight: 16 },
    joinedButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 14,
        minWidth: 118,
        backgroundColor: JOINED_VIVID_BG,
        borderWidth: 2,
        borderColor: JOINED_VIVID_BORDER,
    },
    joinedButtonText: { color: JOINED_VIVID, fontWeight: '800', fontSize: 15 },
    requestedButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 14,
        minWidth: 118,
        backgroundColor: c.warningSoft,
        borderWidth: 1,
        borderColor: c.warning,
    },
    requestedButtonText: { color: isDark ? c.warning : '#B45309', fontWeight: '800', fontSize: 15 },
    fullButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, minWidth: 118, backgroundColor: DANGER_BG, borderWidth: 1, borderColor: DANGER },
    waitlistButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, minWidth: 118, backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent },
    waitlistButtonText: { color: '#6D28D9', fontWeight: '800', fontSize: 15 },
    waitlistJoinButton: {
        backgroundColor: '#6D28D9',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 14,
        minWidth: 118,
        shadowColor: '#4C1D95',
        shadowOpacity: 0.28,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
    },
    waitlistJoinText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    fullClosedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, minWidth: 118, backgroundColor: DANGER_BG, borderWidth: 1, borderColor: '#FECACA' },
    fullClosedText: { color: DANGER_DARK, fontWeight: '800', fontSize: 15 },
    genderBlockedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: isDark ? '#3B1120' : '#FDF2F8',
        borderWidth: 1,
        borderColor: isDark ? '#9D174D' : '#FBCFE8',
    },
    genderBlockedText: { color: '#DB2777', fontWeight: '800', fontSize: 12, flexShrink: 1, textAlign: 'center' },
    organizerBlockedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: c.primarySoft,
        borderWidth: 1,
        borderColor: c.primaryBorder,
    },
    organizerBlockedText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 12, flexShrink: 1, textAlign: 'center' },
    bannerStack: {
        gap: 6,
        marginBottom: 12,
    },
    socialJoinedLine: {
        marginTop: 6,
        marginBottom: 2,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '500',
        color: c.text,
    },
    socialJoinedBold: {
        fontWeight: '800',
        color: c.text,
    },
    friendsBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: c.primarySoft,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: c.primaryBorder,
        marginTop: 10,
        marginBottom: 10,
    },
    friendsBannerText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13, flex: 1 },
    coincidedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: c.primarySoft,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: c.primaryBorder,
    },
    coincidedBannerText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 12, flex: 1 },
    fullButtonText: { color: DANGER_DARK, fontWeight: '800', fontSize: 14 },
    creatorInviteBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: isDark ? c.surfaceSubtle : '#1E293B',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
    },
    creatorInviteBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
    creatorBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, backgroundColor: c.surfaceSubtle },
    creatorBadgePrivate: {
        backgroundColor: c.surface,
        borderWidth: 2,
        borderColor: c.text,
    },
    creatorBadgeText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 12 },
    creatorBadgeTextPrivate: { color: c.text },
    iconActionBtn: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    });
}

export const PlanCard = memo(PlanCardInner, (prev, next) => {
    if (prev.item.id !== next.item.id) return false;
    if (prev.membership !== next.membership) return false;
    if (prev.isSaved !== next.isSaved) return false;
    if (prev.joining !== next.joining) return false;
    if (prev.distanceLabel !== next.distanceLabel) return false;
    if (prev.viewerIsOrganizer !== next.viewerIsOrganizer) return false;
    if (prev.isOwner !== next.isOwner) return false;
    if (prev.currentUserId !== next.currentUserId) return false;
    if (prev.userGenero !== next.userGenero) return false;
    if (prev.item.joinedCount !== next.item.joinedCount) return false;
    if (prev.item.titulo !== next.item.titulo) return false;
    if (prev.item.imagen_url !== next.item.imagen_url) return false;
    const prevCovers = Array.isArray(prev.item.imagenes_url) ? prev.item.imagenes_url.join('\0') : '';
    const nextCovers = Array.isArray(next.item.imagenes_url) ? next.item.imagenes_url.join('\0') : '';
    if (prevCovers !== nextCovers) return false;
    if (prev.item.fecha_evento !== next.item.fecha_evento) return false;
    if (prev.item.participantsList !== next.item.participantsList) return false;
    if (prev.onJoin !== next.onJoin) return false;
    if (prev.onLeave !== next.onLeave) return false;
    if (prev.onDelete !== next.onDelete) return false;
    if (prev.onEdit !== next.onEdit) return false;
    if (prev.onToggleSave !== next.onToggleSave) return false;
    if (prev.onOpenDetail !== next.onOpenDetail) return false;
    if (prev.friendIds !== next.friendIds) return false;
    if (prev.coincidedIds !== next.coincidedIds) return false;
    if (prev.feedTaste !== next.feedTaste) return false;
    return true;
});
