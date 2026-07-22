import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    memo } from 'react';
import {
    Animated,
    Easing,
    Image,
    LayoutAnimation,
    Linking,
    Modal,
    Pressable,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import MapView, { Marker } from 'react-native-maps';
import { resolvePlanImageSource, resolvePlanCategories } from '../lib/sports';
import { canJoinWaitlist, type Membership } from '../lib/participants';
import { canJoinPlanByGender, isSoloChicasPlan } from '../lib/soloChicas';
import { kickParticipant } from '../lib/kickParticipant';
import { useT } from '../lib/i18n';
import { getPlanPendingInvitees, sendPlanInvite, cancelPlanInvite } from '../lib/planInvites';
import { PlanImage } from './PlanImage';
import { InvitePeopleSheet, type InviteProfile } from './InvitePeopleSheet';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const DANGER_DARK = '#DC2626';
const DANGER_BG = '#FEF2F2';
const GOLD = '#D4AF37';

const MAX_VISIBLE_AVATARS = 4;

const avatarFallback = (name?: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'N')}&background=4DA6FF&color=fff`;

export type { Membership } from '../lib/participants';

const isSameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const AvatarStack = ({
    participants,
    maxPeople,
    onOpenRoster,
    dark,
}: {
    participants: any[];
    maxPeople: number;
    onOpenRoster: () => void;
    dark?: boolean;
}) => {
    const { t } = useT();
    if (!participants || participants.length === 0) {
        return (
            <View style={styles.avatarStackRow}>
                <Text style={[styles.beFirstText, dark && styles.beFirstTextDark]}>{t('card.beFirst')} · </Text>
                <Text style={[styles.maxText, dark && styles.maxTextDark]}>({t('card.max', { n: maxPeople })})</Text>
            </View>
        );
    }
    const visible = participants.slice(0, MAX_VISIBLE_AVATARS);
    const extra = participants.length - visible.length;

    return (
        <View style={styles.avatarStackRow}>
            <TouchableOpacity activeOpacity={0.85} onPress={onOpenRoster} style={styles.avatarStackTouchable}>
                <View style={styles.avatarStack}>
                    {visible.map((p, index) => (
                        <View
                            key={p.id ?? index}
                            style={[styles.stackAvatarWrap, { marginLeft: index === 0 ? 0 : -12, zIndex: visible.length - index }]}
                        >
                            <Image
                                source={{ uri: p.avatar_url || avatarFallback(p.nombre) }}
                                style={[styles.stackAvatar, p.isCreator && styles.stackAvatarCreator]}
                            />
                            {p.isCreator && (
                                <View style={styles.creatorDot}>
                                    <Ionicons name="star" size={7} color="#FFF" />
                                </View>
                            )}
                        </View>
                    ))}
                    {extra > 0 && (
                        <View style={[styles.stackAvatarWrap, styles.extraBubble, { marginLeft: -12, zIndex: 0 }]}>
                            <Text style={styles.extraBubbleText}>+{extra}</Text>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} onPress={onOpenRoster}>
                <Text style={[styles.goingText, dark && styles.goingTextDark]}>{t('card.weAre', { n: participants.length })}</Text>
            </TouchableOpacity>
            <Text style={[styles.maxText, dark && styles.maxTextDark]}> ({t('card.max', { n: maxPeople })})</Text>
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
    onJoin: (id: string) => void;
    onLeave: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onToggleSave: (id: string) => void;
    onReport?: (id: string) => void;
    onOpenDetail?: (id: string) => void;
    onParticipantsChanged?: () => void;
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
    onJoin,
    onLeave,
    onDelete,
    onEdit,
    onToggleSave,
    onReport,
    onOpenDetail,
    onParticipantsChanged,
    router,
}: PlanCardProps) {
    const { t } = useT();
    const [expanded, setExpanded] = useState(false);
    const [showRoster, setShowRoster] = useState(false);
    const [showInviteSheet, setShowInviteSheet] = useState(false);
    const [invitees, setInvitees] = useState<InviteProfile[]>([]);
    const entrance = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (index > 4) {
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
    }, [entrance, index]);

    const isCreator = currentUserId && String(item.creador_id) === String(currentUserId);
    const isFull = item.joinedCount >= item.maximo_participantes;
    const requiresApproval = !!item.requiere_aprobacion;
    const participants = item.participantsList || [];
    const friendsInPlan = friendIds
        ? participants.filter((p: { id?: string }) => p.id && friendIds.has(p.id)).length
        : 0;
    // Conocidos = coincidencia previa real; no se solapa con amigos (un amigo no cuenta aquí).
    const coincidedInPlan = coincidedIds
        ? participants.filter(
            (p: { id?: string }) =>
                p.id &&
                p.id !== currentUserId &&
                coincidedIds.has(p.id) &&
                !(friendIds && friendIds.has(p.id)),
        ).length
        : 0;

    const { main: mainCategory, sub: subCategory } = resolvePlanCategories(item);
    const mainCategoryLabel = mainCategory ? t(`cat.main.${mainCategory}`) : '';
    const subCategoryLabel = subCategory ? t(`cat.sub.${subCategory}`) : '';

    const eventDate = item.fecha_evento ? new Date(item.fecha_evento) : null;
    const isToday = eventDate ? isSameCalendarDay(eventDate, new Date()) : false;
    const isPast = eventDate ? eventDate.getTime() < Date.now() : false;
    const isSoloChicas = isSoloChicasPlan(item);
    const isFriendsOnly = !!item.solo_amigos && !item.modo_privado;
    const isPrivate = !!item.modo_privado;
    const canInvite = isCreator && isPrivate && !isPast;
    const genderBlocked = !canJoinPlanByGender(item, userGenero as any);
    const isCalmPremium = !isToday && !isFull && !isSoloChicas && !isFriendsOnly && !isPrivate;
    const dateString = eventDate ? eventDate.toLocaleDateString() : t('card.noDate');
    const timeString = eventDate ? eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    const openDetail = () => {
        if (onOpenDetail) {
            onOpenDetail(item.id);
            return;
        }
        LayoutAnimation.configureNext(LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
        setExpanded(prev => !prev);
    };
    const toggleExpand = openDetail;
    const pressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
    const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

    const buildShareMessage = () => {
        const when = eventDate ? `${dateString}${timeString ? ` a las ${timeString}` : ''}` : '';
        const where = item.nombre_ubicacion ? `\n📍 ${item.nombre_ubicacion}` : '';
        const date = when ? `\n🗓️ ${when}` : '';
        return `¡Únete a "${item.titulo}" en Nexo! 🎉${where}${date}\n\nÁbrelo en la app Nexo para apuntarte.`;
    };

    const openNativeShare = async () => {
        try {
            await Share.share({ message: buildShareMessage() });
        } catch {
            // cancelado por el usuario
        }
    };

    const shareViaWhatsApp = async () => {
        const url = `whatsapp://send?text=${encodeURIComponent(buildShareMessage())}`;
        try {
            await Linking.openURL(url);
        } catch {
            // WhatsApp no instalado → abrimos el menú nativo
            openNativeShare();
        }
    };

    const handleShare = () => {
        Alert.alert(t('card.share'), `"${item.titulo}"`, [
            { text: t('card.shareWhats'), onPress: shareViaWhatsApp },
            { text: t('card.shareOther'), onPress: openNativeShare },
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    };

    const getPlanImageSource = (): string | number => resolvePlanImageSource(item.imagen_url);

    const openInviteSheet = async () => {
        setShowInviteSheet(true);
        try {
            const list = await getPlanPendingInvitees(String(item.id));
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
                <View style={styles.creatorFooterCol}>
                    {canInvite ? (
                        <TouchableOpacity style={styles.creatorInviteBtn} onPress={openInviteSheet} activeOpacity={0.85}>
                            <Ionicons name="person-add" size={18} color="#FFF" />
                            <Text style={styles.creatorInviteBtnText}>{t('card.invite')}</Text>
                        </TouchableOpacity>
                    ) : null}
                    <View style={styles.creatorFooterRow}>
                        <View style={[styles.creatorBadge, isPrivate && styles.creatorBadgePrivate]}>
                            <Ionicons name="star" size={15} color={isPrivate ? '#0F172A' : PRIMARY_DARK} />
                            <Text style={[styles.creatorBadgeText, isPrivate && styles.creatorBadgeTextPrivate]}>{t('card.myPlan')}</Text>
                        </View>
                        <TouchableOpacity style={[styles.iconActionBtn, { backgroundColor: PRIMARY }]} onPress={() => onEdit(item.id)}>
                            <Ionicons name="create" size={20} color="#FFF" />
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.iconActionBtn, { backgroundColor: DANGER }]} onPress={() => onDelete(item.id)}>
                            <Ionicons name="trash" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }
        if (membership === 'requested') {
            return (
                <TouchableOpacity style={styles.requestedButton} onPress={() => onLeave(item.id)}>
                    <Ionicons name="time" size={18} color="#B45309" />
                    <Text style={styles.requestedButtonText}>{t('card.requested')}</Text>
                </TouchableOpacity>
            );
        }
        if (membership === 'joined') {
            return (
                <TouchableOpacity style={styles.joinedButton} onPress={() => onLeave(item.id)}>
                    <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                    <Text style={styles.joinedButtonText}>{t('card.joined')}</Text>
                </TouchableOpacity>
            );
        }
        if (membership === 'waitlist') {
            return (
                <TouchableOpacity style={styles.waitlistButton} onPress={() => onLeave(item.id)}>
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
                <TouchableOpacity style={styles.waitlistJoinButton} onPress={() => onJoin(item.id)} activeOpacity={0.85}>
                    <Ionicons name="list" size={18} color="#FFF" />
                    <Text style={styles.waitlistJoinText}>{t('card.joinWaitlist')}</Text>
                </TouchableOpacity>
            );
        }
        return (
            <TouchableOpacity style={styles.joinButton} onPress={() => onJoin(item.id)} activeOpacity={0.85}>
                <Text style={styles.joinButtonText}>{requiresApproval ? t('card.request') : t('card.join')}</Text>
                <Ionicons name={requiresApproval ? 'shield-checkmark' : 'arrow-forward'} size={18} color="#FFF" />
            </TouchableOpacity>
        );
    };

    return (
        <Animated.View style={{ opacity: entrance, transform: [{ scale }, { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
            <Pressable onPressIn={pressIn} onPressOut={pressOut} onPress={onOpenDetail ? () => onOpenDetail(item.id) : undefined}>
                <View style={[
                    styles.card,
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
                    <View style={styles.imageWrap}>
                        <PlanImage
                            source={getPlanImageSource()}
                            style={styles.cardImage}
                            recyclingKey={String(item.id)}
                            priority={index < 3 ? 'high' : 'normal'}
                        />
                        <LinearGradient
                            colors={
                                isPrivate
                                    ? ['rgba(15,23,42,0)', 'rgba(15,23,42,0.45)']
                                    : isFriendsOnly
                                      ? ['rgba(21,128,61,0)', 'rgba(21,128,61,0.28)']
                                      : isToday
                                        ? ['rgba(180,83,9,0)', 'rgba(120,53,15,0.65)']
                                        : ['rgba(15,42,74,0)', 'rgba(15,42,74,0.55)']
                            }
                            style={styles.imageShade}
                        />
                        {isFull && <View style={styles.fullVeil} />}
                        {isToday && !isFull && (
                            <View style={styles.todayBadge}>
                                <Ionicons name="flash" size={14} color="#FFF" />
                                <Text style={styles.todayBadgeText}>{t('card.todayBadge')}</Text>
                            </View>
                        )}

                        <View style={styles.topRow}>
                            <View style={styles.topLeftTags}>
                                {mainCategoryLabel ? (
                                    <View style={styles.mainCategoryTag}>
                                        <Text style={styles.mainCategoryText}>{mainCategoryLabel}</Text>
                                    </View>
                                ) : null}
                                {subCategoryLabel ? (
                                    <View style={styles.subCategoryTag}>
                                        <Text style={styles.subCategoryText}>{subCategoryLabel}</Text>
                                    </View>
                                ) : null}
                                {isSoloChicas ? (
                                    <View style={styles.soloChicasTag}>
                                        <Ionicons name="female" size={11} color="#FFF" />
                                        <Text style={styles.soloChicasTagText}>{t('createplan.soloChicasTitle')}</Text>
                                    </View>
                                ) : null}
                                {isFriendsOnly ? (
                                    <View style={styles.friendsOnlyTag}>
                                        <Ionicons name="people" size={11} color="#FFF" />
                                        <Text style={styles.friendsOnlyTagText}>{t('createplan.friendsOnlyTitle')}</Text>
                                    </View>
                                ) : null}
                                {isPrivate ? (
                                    <View style={styles.privateTag}>
                                        <Ionicons name="lock-closed" size={11} color="#FFF" />
                                        <Text style={styles.privateTagText}>{t('card.privateTag')}</Text>
                                    </View>
                                ) : null}
                            </View>
                            <View style={styles.topRightGroup}>
                                {!isCreator && onReport ? (
                                    <TouchableOpacity
                                        style={styles.circleBtnSmall}
                                        onPress={() => onReport(item.id)}
                                        hitSlop={8}
                                        activeOpacity={0.85}
                                    >
                                        <Ionicons name="flag" size={16} color="#FECACA" />
                                    </TouchableOpacity>
                                ) : null}
                                <TouchableOpacity style={styles.circleBtn} onPress={handleShare} hitSlop={8}>
                                    <Ionicons name="arrow-redo" size={19} color="#FFF" />
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.circleBtn} onPress={() => onToggleSave(item.id)} hitSlop={8}>
                                    <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={20} color={isSaved ? DANGER : '#FFF'} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {isFull && (
                            <View style={styles.fullBadgeCenter}>
                                <Ionicons name="ban" size={18} color="#FFF" />
                                <Text style={styles.fullBadgeCenterText}>{t('card.full')}</Text>
                            </View>
                        )}

                        <View style={styles.imageBottomRow}>
                            <Text style={styles.cardTitleOnImage} numberOfLines={2}>{item.titulo}</Text>
                        </View>
                    </View>

                    <View style={[styles.cardContent, isPrivate && styles.cardContentPrivate, isFriendsOnly && styles.cardContentFriends]}>
                        <AvatarStack
                            participants={participants}
                            maxPeople={item.maximo_participantes}
                            dark={false}
                            onOpenRoster={() => {
                                if (onOpenDetail) onOpenDetail(item.id);
                                else if (participants.length > 0) setShowRoster(true);
                            }}
                        />

                        {(friendsInPlan > 0 || coincidedInPlan > 0 || isToday) && (
                            <View style={styles.bannerStack}>
                                {friendsInPlan > 0 && (
                                    <View style={[styles.friendsBanner, isPrivate && styles.friendsBannerOnPrivate, isFriendsOnly && styles.friendsBannerOnFriends]}>
                                        <Ionicons name="people" size={16} color={isFriendsOnly ? '#15803D' : PRIMARY_DARK} />
                                        <Text style={[styles.friendsBannerText, isFriendsOnly && styles.friendsBannerTextFriends]}>
                                            {t(friendsInPlan === 1 ? 'card.friendsJoinedOne' : 'card.friendsJoinedMany', { n: friendsInPlan })}
                                        </Text>
                                    </View>
                                )}

                                {coincidedInPlan > 0 && (
                                    <View style={[styles.coincidedBanner, isPrivate && styles.coincidedBannerOnPrivate]}>
                                        <Ionicons name="sparkles" size={14} color="#7C3AED" />
                                        <Text style={styles.coincidedBannerText}>
                                            {t(
                                                coincidedInPlan === 1 ? 'card.coincidedOne' : 'card.coincidedMany',
                                                { n: coincidedInPlan },
                                            )}
                                        </Text>
                                    </View>
                                )}

                                {isToday && (
                                    <View style={styles.todayBanner}>
                                        <Ionicons name="time" size={16} color="#B45309" />
                                        <Text style={styles.todayBannerText}>{t('card.today')}</Text>
                                    </View>
                                )}
                            </View>
                        )}

                        <View style={styles.metaRow}>
                            <View style={styles.metaItem}>
                                <Ionicons
                                    name="calendar-outline"
                                    size={15}
                                    color={isPrivate ? INK : isFriendsOnly ? '#15803D' : isToday ? '#B45309' : PRIMARY_DARK}
                                />
                                <Text style={[
                                    styles.metaText,
                                    isToday && styles.metaTextToday,
                                    isFriendsOnly && styles.metaTextFriends,
                                    isPrivate && styles.metaTextPrivate,
                                ]}>
                                    {dateString}{timeString ? ` · ${timeString}` : ''}
                                </Text>
                            </View>
                            <View style={styles.metaItem}>
                                <Ionicons
                                    name="location-outline"
                                    size={15}
                                    color={isPrivate ? INK : isFriendsOnly ? '#15803D' : PRIMARY_DARK}
                                />
                                <Text style={[
                                    styles.metaText,
                                    isFriendsOnly && styles.metaTextFriends,
                                    isPrivate && styles.metaTextPrivate,
                                ]} numberOfLines={1}>{item.nombre_ubicacion || t('card.location')}</Text>
                            </View>
                        </View>

                        {expanded && !onOpenDetail && (
                            <View style={styles.expandedSection}>
                                <Text style={[styles.descLabel, isPrivate && styles.descLabelPrivate]}>{t('card.aboutPlan')}</Text>
                                <Text style={[styles.descriptionText, isPrivate && styles.descriptionTextPrivate]}>{item.descripcion || t('card.noDescription')}</Text>
                                <View style={styles.miniMapContainer}>
                                    <MapView
                                        style={styles.miniMap}
                                        scrollEnabled
                                        zoomEnabled
                                        initialRegion={{ latitude: item.latitud || 40.4167, longitude: item.longitud || -3.7037, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
                                    >
                                        <Marker coordinate={{ latitude: item.latitud || 40.4167, longitude: item.longitud || -3.7037 }} />
                                    </MapView>
                                </View>
                            </View>
                        )}

                        <TouchableOpacity style={styles.expandHint} onPress={toggleExpand} activeOpacity={0.7}>
                            <Text style={[styles.expandHintText, isPrivate && styles.expandHintTextPrivate]}>
                                {onOpenDetail ? t('card.tapDetail') : expanded ? t('card.tapCollapse') : t('card.tapExpand')}
                            </Text>
                            <Ionicons name={onOpenDetail ? 'open-outline' : expanded ? 'chevron-up' : 'chevron-down'} size={16} color={isPrivate ? '#334155' : '#94A3B8'} />
                        </TouchableOpacity>

                        <View style={styles.cardFooter}>{renderFooter()}</View>
                    </View>
                    </View>
                </View>
            </Pressable>

            <Modal visible={showRoster} transparent animationType="fade" onRequestClose={() => setShowRoster(false)}>
                <Pressable style={styles.rosterOverlay} onPress={() => setShowRoster(false)}>
                    <Pressable style={styles.rosterSheet} onPress={(e) => e.stopPropagation()}>
                        <View style={styles.rosterHandle} />
                        <Text style={styles.rosterTitle}>
                            {t('card.participants')} · {participants.length}
                        </Text>
                        {participants.map((p: any) => (
                            <View key={p.id} style={styles.rosterRowWrap}>
                                <TouchableOpacity
                                    style={[styles.rosterRow, { flex: 1 }]}
                                    activeOpacity={0.8}
                                    onPress={() => {
                                        setShowRoster(false);
                                        router.push({
                                            pathname: '/user-profile/[id]',
                                            params: { id: p.id },
                                        });
                                    }}
                                >
                                    <Image
                                        source={{ uri: p.avatar_url || avatarFallback(p.nombre) }}
                                        style={[styles.rosterAvatar, p.isCreator && styles.stackAvatarCreator]}
                                    />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.rosterName}>{p.nombre || t('profile.user')}</Text>
                                        {p.isCreator && (
                                            <Text style={styles.rosterCreatorLabel}>{t('chat.host')}</Text>
                                        )}
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                                </TouchableOpacity>
                                {isCreator && !p.isCreator && currentUserId && (
                                    <TouchableOpacity
                                        style={styles.rosterKickBtn}
                                        onPress={() => {
                                            Alert.alert(
                                                t('planDetail.kickTitle'),
                                                t('planDetail.kickMsg', { name: p.nombre || t('profile.user') }),
                                                [
                                                    { text: t('common.cancel'), style: 'cancel' },
                                                    {
                                                        text: t('planDetail.kickConfirm'),
                                                        style: 'destructive',
                                                        onPress: async () => {
                                                            const { error } = await kickParticipant(
                                                                item.id,
                                                                p.id,
                                                                currentUserId,
                                                            );
                                                            if (error) Alert.alert(t('feed.error'), error);
                                                            else onParticipantsChanged?.();
                                                            setShowRoster(false);
                                                        },
                                                    },
                                                ],
                                            );
                                        }}
                                    >
                                        <Ionicons name="person-remove" size={20} color={DANGER} />
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
                    excludeIds={memberExcludeIds}
                    onAdd={handleInviteAdd}
                    onRemove={handleInviteRemove}
                />
            ) : null}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 26, marginBottom: 22, overflow: 'hidden', elevation: 10, shadowColor: '#1E3A8A', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
    cardFull: { padding: 3, overflow: 'visible', elevation: 12, shadowColor: DANGER_DARK, shadowOpacity: 0.28, borderRadius: 28 },
    fullBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerFull: { borderColor: DANGER, borderWidth: 2, backgroundColor: DANGER_BG },
    cardToday: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#D97706', shadowOpacity: 0.35, borderRadius: 28 },
    cardSoloChicas: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#DB2777', shadowOpacity: 0.35, borderRadius: 28 },
    soloChicasBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerSoloChicas: { backgroundColor: '#FDF2F8', borderColor: '#F9A8D4', borderWidth: 1.5 },
    cardFriends: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#16A34A', shadowOpacity: 0.32, borderRadius: 28 },
    friendsBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerFriends: { backgroundColor: '#FAFDFB', borderColor: '#86EFAC', borderWidth: 1.5 },
    cardPrivate: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#020617', shadowOpacity: 0.45, borderRadius: 28 },
    privateBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerPrivate: { backgroundColor: '#EEF2F7', borderColor: '#64748B', borderWidth: 1.5 },
    cardContentFriends: { backgroundColor: '#FAFDFB' },
    cardContentPrivate: { backgroundColor: '#EEF2F7' },
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
    metaTextFriends: { color: '#166534', fontWeight: '700' },
    metaTextPrivate: { color: '#0F172A', fontWeight: '800' },
    friendsBannerOnFriends: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
    friendsBannerTextFriends: { color: '#15803D' },
    friendsBannerOnPrivate: { backgroundColor: '#E0E7FF', borderColor: '#A5B4FC' },
    friendsBannerTextPrivate: { color: '#3730A3' },
    coincidedBannerOnPrivate: { backgroundColor: '#EDE9FE', borderColor: '#C4B5FD' },
    expandHintTextPrivate: { color: '#1E293B', fontWeight: '800' },
    descLabelPrivate: { color: '#0F172A' },
    descriptionTextPrivate: { color: '#334155' },
    cardPremium: { padding: 2, overflow: 'visible', elevation: 12, shadowColor: '#2563EB', shadowOpacity: 0.2, borderRadius: 28 },
    todayBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    premiumBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInner: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#FFF', borderWidth: 1, borderColor: 'rgba(37,99,235,0.06)' },
    cardInnerToday: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1.5 },
    cardInnerPremium: { backgroundColor: '#FAFCFF', borderColor: 'rgba(96,165,250,0.35)', borderWidth: 1 },
    todayBadge: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D97706', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, zIndex: 5, elevation: 6, shadowColor: '#92400E', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    todayBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
    todayBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FCD34D' },
    todayBannerText: { color: '#B45309', fontWeight: '800', fontSize: 14 },
    metaTextToday: { color: '#92400E', fontWeight: '800' },
    avatarStackTouchable: { flexDirection: 'row', alignItems: 'center' },
    rosterOverlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.45)', justifyContent: 'flex-end' },
    rosterSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 28, maxHeight: '55%' },
    rosterHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 14 },
    rosterTitle: { fontSize: 16, fontWeight: '900', color: INK, marginBottom: 12 },
    rosterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    rosterRowWrap: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    rosterKickBtn: { padding: 10 },
    rosterAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: '#E3ECFB' },
    rosterName: { fontSize: 16, fontWeight: '700', color: INK },
    rosterCreatorLabel: { fontSize: 11, fontWeight: '700', color: '#B45309', marginTop: 2 },
    imageWrap: { width: '100%', height: 240, position: 'relative' },
    cardImage: { width: '100%', height: '100%' },
    imageShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
    fullVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(185,28,28,0.28)' },
    topRow: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 4 },
    topLeftTags: { flexDirection: 'column', alignItems: 'flex-start', gap: 5, flexShrink: 1, maxWidth: '62%' },
    topRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
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
    subCategoryText: { color: '#334155', fontSize: 11, fontWeight: '700' },
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
    circleBtn: { backgroundColor: 'rgba(15,42,74,0.4)', width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
    circleBtnSmall: { backgroundColor: 'rgba(127,29,29,0.75)', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
    fullBadgeCenter: { position: 'absolute', top: 60, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DANGER_DARK, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, transform: [{ rotate: '-4deg' }], elevation: 4, borderWidth: 2, borderColor: '#FFF' },
    fullBadgeCenterText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
    imageBottomRow: { position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    cardTitleOnImage: { flex: 1, color: '#FFF', fontSize: 22, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },

    cardContent: { padding: 18 },
    avatarStackRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' },
    avatarStack: { flexDirection: 'row', alignItems: 'center' },
    stackAvatarWrap: { position: 'relative' },
    stackAvatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#FFF', backgroundColor: '#E3ECFB' },
    stackAvatarCreator: { borderColor: GOLD },
    creatorDot: { position: 'absolute', bottom: -1, right: -1, backgroundColor: GOLD, borderRadius: 6, width: 13, height: 13, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FFF' },
    extraBubble: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#FFF', backgroundColor: PRIMARY_DARK, justifyContent: 'center', alignItems: 'center' },
    extraBubbleText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
    goingText: { marginLeft: 10, fontSize: 13, fontWeight: '800', color: INK },
    goingTextDark: { color: '#F1F5F9' },
    maxText: { fontSize: 13, fontWeight: '700', color: '#94A3B8' },
    maxTextDark: { color: '#CBD5E1' },
    beFirstText: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
    beFirstTextDark: { color: '#CBD5E1' },

    futbolChip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, backgroundColor: '#EAF3E9', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#CDE7CB' },
    futbolBall: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2E9E5B', justifyContent: 'center', alignItems: 'center' },
    futbolFormatText: { fontSize: 16, fontWeight: '900', color: '#1B7A42' },
    futbolChipHint: { flex: 1, fontSize: 13, fontWeight: '700', color: '#3E7A52' },
    fieldModal: { flex: 1, backgroundColor: '#F2F7FF' },
    fieldModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#EEF3FB' },
    fieldCloseBtn: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#EEF3FB', justifyContent: 'center', alignItems: 'center' },
    fieldModalTitle: { fontSize: 18, fontWeight: '900', color: INK },
    fieldModalSub: { fontSize: 13, fontWeight: '600', color: '#64748B' },
    fieldModalBody: { flex: 1, padding: 18 },
    fieldModalHint: { textAlign: 'center', color: '#64748B', fontWeight: '600', fontSize: 13, marginTop: 14 },
    metaRow: { gap: 8 },
    metaItem: { flexDirection: 'row', alignItems: 'center' },
    metaText: { marginLeft: 7, fontSize: 14, color: '#475569', fontWeight: '600', flexShrink: 1 },

    expandedSection: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#EEF3FB' },
    descLabel: { fontSize: 11, fontWeight: '800', color: '#94A3B8', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.3 },
    descriptionText: { fontSize: 14, color: '#475569', lineHeight: 21 },
    miniMapContainer: { height: 180, width: '100%', borderRadius: 16, overflow: 'hidden', marginTop: 14, borderWidth: 1, borderColor: '#E3ECFB' },
    miniMap: { flex: 1 },
    expandHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12 },
    expandHintText: { fontSize: 12, color: '#94A3B8', fontWeight: '600' },

    cardFooter: { marginTop: 12 },
    joinButton: { backgroundColor: PRIMARY_DARK, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16 },
    joinButtonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    joinedButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: SUCCESS + '18', borderWidth: 1, borderColor: SUCCESS },
    joinedButtonText: { color: SUCCESS, fontWeight: '800', fontSize: 14 },
    requestedButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D' },
    requestedButtonText: { color: '#B45309', fontWeight: '800', fontSize: 14 },
    fullButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: DANGER_BG, borderWidth: 1, borderColor: DANGER },
    waitlistButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#C4B5FD' },
    waitlistButtonText: { color: '#6D28D9', fontWeight: '800', fontSize: 15 },
    waitlistJoinButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: '#7C3AED' },
    waitlistJoinText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    fullClosedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: DANGER_BG, borderWidth: 1, borderColor: '#FECACA' },
    fullClosedText: { color: DANGER_DARK, fontWeight: '800', fontSize: 15 },
    genderBlockedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 16,
        backgroundColor: '#FDF2F8',
        borderWidth: 1,
        borderColor: '#FBCFE8',
    },
    genderBlockedText: { color: '#DB2777', fontWeight: '800', fontSize: 14, flex: 1, textAlign: 'center' },
    bannerStack: {
        gap: 6,
        marginBottom: 12,
    },
    friendsBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#EFF6FF',
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    friendsBannerText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13, flex: 1 },
    coincidedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#F5F3FF',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: '#DDD6FE',
    },
    coincidedBannerText: { color: '#6D28D9', fontWeight: '700', fontSize: 12, flex: 1 },
    fullButtonText: { color: DANGER_DARK, fontWeight: '800', fontSize: 14 },
    creatorFooterCol: { gap: 10 },
    creatorInviteBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#1E293B',
        paddingVertical: 12,
        borderRadius: 16,
    },
    creatorInviteBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
    creatorFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    creatorBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 16, backgroundColor: '#EEF3FB' },
    creatorBadgePrivate: {
        backgroundColor: '#FFF',
        borderWidth: 2,
        borderColor: '#0F172A',
    },
    creatorBadgeText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 14 },
    creatorBadgeTextPrivate: { color: '#0F172A' },
    iconActionBtn: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
});

export const PlanCard = memo(PlanCardInner);
