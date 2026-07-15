import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, memo } from 'react';
import {
    Alert,
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
import MapView, { Marker } from 'react-native-maps';
import { resolvePlanSport } from '../lib/sports';
import { useT } from '../lib/i18n';
import { SportIcon } from './SportIcon';
import { PlanImage } from './PlanImage';

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

export type Membership = 'none' | 'joined' | 'requested';

const isSameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const AvatarStack = ({
    participants,
    maxPeople,
    onOpenRoster,
}: {
    participants: any[];
    maxPeople: number;
    onOpenRoster: () => void;
}) => {
    const { t } = useT();
    if (!participants || participants.length === 0) {
        return (
            <View style={styles.avatarStackRow}>
                <Text style={styles.beFirstText}>{t('card.beFirst')} · </Text>
                <Text style={styles.maxText}>({t('card.max', { n: maxPeople })})</Text>
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
                <Text style={styles.goingText}>{t('card.weAre', { n: participants.length })}</Text>
            </TouchableOpacity>
            <Text style={styles.maxText}> ({t('card.max', { n: maxPeople })})</Text>
        </View>
    );
};

interface PlanCardProps {
    item: any;
    index: number;
    currentUserId: string | null;
    membership: Membership;
    isSaved: boolean;
    onJoin: (id: string) => void;
    onLeave: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onToggleSave: (id: string) => void;
    onReport?: (id: string) => void;
    router: any;
}

function PlanCardInner({
    item,
    index,
    currentUserId,
    membership,
    isSaved,
    onJoin,
    onLeave,
    onDelete,
    onEdit,
    onToggleSave,
    onReport,
    router,
}: PlanCardProps) {
    const { t } = useT();
    const [expanded, setExpanded] = useState(false);
    const [showRoster, setShowRoster] = useState(false);
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

    const sportPlan = resolvePlanSport(item);
    const categoryLabel = t('cat.' + item.categoria);

    const eventDate = item.fecha_evento ? new Date(item.fecha_evento) : null;
    const isToday = eventDate ? isSameCalendarDay(eventDate, new Date()) : false;
    const isCalmPremium = !isToday && !isFull;
    const dateString = eventDate ? eventDate.toLocaleDateString() : t('card.noDate');
    const timeString = eventDate ? eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
        setExpanded(prev => !prev);
    };
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

    const getPlanImageSource = (): string | number => {
        if (!item.imagen_url) return 'https://via.placeholder.com/400';
        const urlStr = String(item.imagen_url);
        if (urlStr.startsWith('http')) return urlStr;
        const parsedId = parseInt(urlStr, 10);
        if (!isNaN(parsedId)) return parsedId;
        return 'https://via.placeholder.com/400';
    };

    const renderFooter = () => {
        if (isCreator) {
            return (
                <View style={styles.creatorFooterRow}>
                    <View style={styles.creatorBadge}>
                        <Ionicons name="star" size={15} color={PRIMARY_DARK} />
                        <Text style={styles.creatorBadgeText}>{t('card.myPlan')}</Text>
                    </View>
                    <TouchableOpacity style={[styles.iconActionBtn, { backgroundColor: PRIMARY }]} onPress={() => onEdit(item.id)}>
                        <Ionicons name="create" size={20} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.iconActionBtn, { backgroundColor: DANGER }]} onPress={() => onDelete(item.id)}>
                        <Ionicons name="trash" size={20} color="#FFF" />
                    </TouchableOpacity>
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
        if (isFull) {
            return (
                <View style={styles.fullButton}>
                    <Ionicons name="ban" size={18} color={DANGER_DARK} />
                    <Text style={styles.fullButtonText}>{t('card.full')}</Text>
                </View>
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
            <Pressable onPressIn={pressIn} onPressOut={pressOut}>
                <View style={[styles.card, isToday && styles.cardToday, isCalmPremium && styles.cardPremium, isFull && !isToday && styles.cardFull]}>
                    {isToday && (
                        <LinearGradient
                            colors={['#F59E0B', '#D97706', '#B45309']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.todayBorder}
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
                    <View style={[styles.cardInner, isToday && styles.cardInnerToday, isCalmPremium && styles.cardInnerPremium, isFull && styles.cardInnerFull]}>
                    <View style={styles.imageWrap}>
                        <PlanImage
                            source={getPlanImageSource()}
                            style={styles.cardImage}
                            recyclingKey={String(item.id)}
                            priority={index < 3 ? 'high' : 'normal'}
                        />
                        <LinearGradient
                            colors={isToday ? ['rgba(180,83,9,0)', 'rgba(120,53,15,0.65)'] : ['rgba(15,42,74,0)', 'rgba(15,42,74,0.55)']}
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
                            <View style={styles.categoryTag}>
                                <Text style={styles.categoryTagText}>{categoryLabel}</Text>
                            </View>
                            <View style={styles.topRightGroup}>
                                {!isCreator && onReport ? (
                                    <TouchableOpacity style={styles.circleBtn} onPress={() => onReport(item.id)} hitSlop={8}>
                                        <Ionicons name="flag-outline" size={17} color="#FFF" />
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

                    <View style={styles.cardContent}>
                        <AvatarStack
                            participants={participants}
                            maxPeople={item.maximo_participantes}
                            onOpenRoster={() => participants.length > 0 && setShowRoster(true)}
                        />

                        {isToday && (
                            <View style={styles.todayBanner}>
                                <Ionicons name="time" size={16} color="#B45309" />
                                <Text style={styles.todayBannerText}>{t('card.today')}</Text>
                            </View>
                        )}

                        <View style={styles.metaRow}>
                            <View style={styles.metaItem}>
                                <Ionicons name="calendar-outline" size={15} color={isToday ? '#B45309' : PRIMARY_DARK} />
                                <Text style={[styles.metaText, isToday && styles.metaTextToday]}>
                                    {dateString}{timeString ? ` · ${timeString}` : ''}
                                </Text>
                            </View>
                            <View style={styles.metaItem}>
                                <Ionicons name="location-outline" size={15} color={PRIMARY_DARK} />
                                <Text style={styles.metaText} numberOfLines={1}>{item.nombre_ubicacion || t('card.location')}</Text>
                            </View>
                        </View>

                        {sportPlan && (
                            <View style={styles.futbolChip}>
                                <View style={styles.futbolBall}>
                                    <SportIcon sport={sportPlan.tipo} size={20} color="#FFF" />
                                </View>
                                <Text style={styles.futbolFormatText}>
                                    {sportPlan.formato ?? t('sport.' + sportPlan.tipo)}
                                </Text>
                                <Text style={styles.futbolChipHint}>{t('sport.' + sportPlan.tipo)}</Text>
                            </View>
                        )}

                        {expanded && (
                            <View style={styles.expandedSection}>
                                <Text style={styles.descLabel}>{t('card.aboutPlan')}</Text>
                                <Text style={styles.descriptionText}>{item.descripcion || t('card.noDescription')}</Text>
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
                            <Text style={styles.expandHintText}>{expanded ? t('card.tapCollapse') : t('card.tapExpand')}</Text>
                            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
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
                            <TouchableOpacity
                                key={p.id}
                                style={styles.rosterRow}
                                activeOpacity={0.8}
                                onPress={() => {
                                    setShowRoster(false);
                                    router.push({ pathname: '/user-profile/[id]', params: { id: p.id } });
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
                        ))}
                    </Pressable>
                </Pressable>
            </Modal>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 26, marginBottom: 22, overflow: 'hidden', elevation: 10, shadowColor: '#1E3A8A', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
    cardFull: { padding: 3, overflow: 'visible', elevation: 12, shadowColor: DANGER_DARK, shadowOpacity: 0.28, borderRadius: 28 },
    fullBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInnerFull: { borderColor: DANGER, borderWidth: 2, backgroundColor: DANGER_BG },
    cardToday: { padding: 3, overflow: 'visible', elevation: 14, shadowColor: '#D97706', shadowOpacity: 0.35, borderRadius: 28 },
    cardPremium: { padding: 2, overflow: 'visible', elevation: 12, shadowColor: '#2563EB', shadowOpacity: 0.2, borderRadius: 28 },
    todayBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    premiumBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 28 },
    cardInner: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#FFF', borderWidth: 1, borderColor: 'rgba(37,99,235,0.06)' },
    cardInnerToday: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1.5 },
    cardInnerPremium: { backgroundColor: '#FAFCFF', borderColor: 'rgba(96,165,250,0.35)', borderWidth: 1 },
    todayBadge: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D97706', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, zIndex: 5, elevation: 6, shadowColor: '#92400E', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    todayBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
    todayBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#FCD34D' },
    todayBannerText: { color: '#B45309', fontWeight: '800', fontSize: 14 },
    metaTextToday: { color: '#92400E', fontWeight: '800' },
    avatarStackTouchable: { flexDirection: 'row', alignItems: 'center' },
    rosterOverlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.45)', justifyContent: 'flex-end' },
    rosterSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 28, maxHeight: '55%' },
    rosterHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 14 },
    rosterTitle: { fontSize: 16, fontWeight: '900', color: INK, marginBottom: 12 },
    rosterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    rosterAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: '#E3ECFB' },
    rosterName: { fontSize: 16, fontWeight: '700', color: INK },
    rosterCreatorLabel: { fontSize: 11, fontWeight: '700', color: '#B45309', marginTop: 2 },
    imageWrap: { width: '100%', height: 190, position: 'relative' },
    cardImage: { width: '100%', height: '100%' },
    imageShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
    fullVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(185,28,28,0.28)' },
    topRow: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    topRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    categoryTag: { backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
    categoryTagText: { color: PRIMARY_DARK, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
    circleBtn: { backgroundColor: 'rgba(15,42,74,0.4)', width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
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
    maxText: { fontSize: 13, fontWeight: '700', color: '#94A3B8' },
    beFirstText: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },

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
    fullButtonText: { color: DANGER_DARK, fontWeight: '800', fontSize: 14 },
    creatorFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    creatorBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 16, backgroundColor: '#EEF3FB' },
    creatorBadgeText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 14 },
    iconActionBtn: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
});

export const PlanCard = memo(PlanCardInner);
