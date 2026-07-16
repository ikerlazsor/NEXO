import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    Platform,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlanImage } from '../../components/PlanImage';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { SportIcon } from '../../components/SportIcon';
import { getAuthUser } from '../../lib/auth';
import { getFriends } from '../../lib/friends';
import {
    canJoinWaitlist,
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
    type Membership,
} from '../../lib/participants';
import { useT } from '../../lib/i18n';
import { renderRatingStars } from '../../lib/profileRating';
import { EMPTY_STATS, getUserStats, type UserStats } from '../../lib/stats';
import { resolvePlanImageSource, resolvePlanSport } from '../../lib/sports';
import { supabase } from '../../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const HERO_H = Math.min(300, SCREEN_W * 0.72);

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const SURFACE = '#FFFFFF';
const BORDER = '#E2E8F0';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const FRIEND = '#10B981';
const FRIEND_BG = '#ECFDF5';
const FRIEND_BORDER = '#6EE7B7';
const GOLD = '#F59E0B';
const WAITLIST = '#7C3AED';

type Participant = {
    id: string;
    nombre: string;
    avatar_url?: string | null;
    isCreator?: boolean;
};

type PlanRow = {
    id: string;
    titulo: string;
    imagen_url: string | null;
    categoria: string;
    tipo_deporte: string | null;
    fecha_evento: string | null;
    nombre_ubicacion: string | null;
    latitud: number | null;
    longitud: number | null;
    maximo_participantes: number;
    creador_id: string;
    requiere_aprobacion: boolean;
    descripcion: string | null;
};

function PersonBubble({
    person,
    isFriend,
    subtitle,
    onPress,
    size = 64,
}: {
    person: Participant;
    isFriend: boolean;
    subtitle?: string;
    onPress: () => void;
    size?: number;
}) {
    const { t } = useT();
    return (
        <TouchableOpacity style={styles.personBubble} activeOpacity={0.85} onPress={onPress}>
            <View
                style={[
                    styles.personAvatarRing,
                    { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 },
                    isFriend && styles.personAvatarRingFriend,
                ]}
            >
                <ProfileAvatar
                    uri={person.avatar_url}
                    name={person.nombre}
                    size={size}
                    recyclingKey={person.id}
                />
                {person.isCreator && (
                    <View style={styles.creatorStar}>
                        <Ionicons name="star" size={10} color="#FFF" />
                    </View>
                )}
            </View>
            <Text
                style={[styles.personName, isFriend && styles.personNameFriend]}
                numberOfLines={1}
            >
                {person.nombre || t('planDetail.anonymous')}
            </Text>
            {subtitle ? (
                <Text style={[styles.personSubtitle, isFriend && styles.personSubtitleFriend]} numberOfLines={1}>
                    {subtitle}
                </Text>
            ) : null}
            {isFriend && (
                <View style={styles.friendPill}>
                    <Ionicons name="heart" size={10} color={FRIEND} />
                    <Text style={styles.friendPillText}>{t('planDetail.friend')}</Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

export default function PlanDetailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useT();
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const planId = Array.isArray(id) ? id[0] : id;

    const [loading, setLoading] = useState(true);
    const [plan, setPlan] = useState<PlanRow | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [joinedCount, setJoinedCount] = useState(0);
    const [creator, setCreator] = useState<Participant | null>(null);
    const [creatorStats, setCreatorStats] = useState<UserStats>(EMPTY_STATS);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [membership, setMembership] = useState<Membership>('none');
    const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
    const [isSaved, setIsSaved] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);

    const loadPlan = useCallback(async () => {
        if (!planId) return;
        try {
            setLoading(true);

            const user = await getAuthUser();
            setCurrentUserId(user?.id ?? null);

            const { data: planRow, error } = await supabase
                .from('planes')
                .select(
                    'id, titulo, imagen_url, categoria, tipo_deporte, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion',
                )
                .eq('id', planId)
                .maybeSingle();

            if (error || !planRow) {
                setPlan(null);
                return;
            }

            setPlan(planRow as PlanRow);

            const [partsRes, creatorRes, myPartRes, savedRes, friendsData, stats] = await Promise.all([
                supabase
                    .from('participantes')
                    .select('usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)')
                    .eq('plan_id', planId)
                    .eq('estado', 'aceptado'),
                supabase
                    .from('perfiles')
                    .select('id, nombre, avatar_url')
                    .eq('id', planRow.creador_id)
                    .maybeSingle(),
                user
                    ? supabase
                          .from('participantes')
                          .select('estado')
                          .eq('plan_id', planId)
                          .eq('usuario_id', user.id)
                          .maybeSingle()
                    : Promise.resolve({ data: null, error: null }),
                user
                    ? supabase
                          .from('planes_guardados')
                          .select('plan_id')
                          .eq('plan_id', planId)
                          .eq('usuario_id', user.id)
                          .maybeSingle()
                    : Promise.resolve({ data: null, error: null }),
                user ? getFriends(user.id) : Promise.resolve([]),
                getUserStats(planRow.creador_id),
            ]);

            const accepted = (partsRes.data || []).filter((p: { estado: string }) =>
                isAcceptedParticipant(p.estado),
            );
            setJoinedCount(accepted.length);

            const creatorProfile: Participant | null = creatorRes.data
                ? { ...creatorRes.data, isCreator: true }
                : null;
            setCreator(creatorProfile);
            setCreatorStats(stats);

            const list: Participant[] = [];
            if (creatorProfile) list.push(creatorProfile);
            accepted.forEach((p: any) => {
                const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
                if (prof && prof.id !== planRow.creador_id) {
                    list.push({ ...prof, isCreator: false });
                }
            });
            setParticipants(list);

            if (myPartRes.data?.estado) {
                setMembership(mapEstadoToMembership(myPartRes.data.estado) ?? 'none');
            } else {
                setMembership('none');
            }

            setIsSaved(!!savedRes.data);
            setFriendIds(new Set(friendsData.map((f) => f.id)));
        } finally {
            setLoading(false);
        }
    }, [planId]);

    useFocusEffect(
        useCallback(() => {
            loadPlan();
        }, [loadPlan]),
    );

    const isCreator = currentUserId && plan && String(plan.creador_id) === String(currentUserId);
    const isFull = plan ? joinedCount >= plan.maximo_participantes : false;
    const requiresApproval = !!plan?.requiere_aprobacion;
    const waitlistOpen = canJoinWaitlist(plan?.fecha_evento);

    const eventDate = plan?.fecha_evento ? new Date(plan.fecha_evento) : null;
    const dateString = eventDate ? eventDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : t('card.noDate');
    const timeString = eventDate
        ? eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
    const sportPlan = plan ? resolvePlanSport(plan) : null;
    const lat = plan?.latitud ?? 40.4167;
    const lng = plan?.longitud ?? -3.7037;

    const openProfile = (userId: string) => {
        router.push({ pathname: '/user-profile/[id]', params: { id: userId } });
    };

    const handleShare = async () => {
        if (!plan) return;
        const when = eventDate ? `${dateString}${timeString ? ` · ${timeString}` : ''}` : '';
        const where = plan.nombre_ubicacion ? `\n📍 ${plan.nombre_ubicacion}` : '';
        const message = `"${plan.titulo}"${where}${when ? `\n🗓️ ${when}` : ''}\n\n${t('planDetail.shareHint')}`;
        try {
            await Share.share({ message });
        } catch {
            // cancelled
        }
    };

    const handleToggleSave = async () => {
        if (!currentUserId || !planId) return;
        const prev = isSaved;
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
            const { error } = await supabase
                .from('planes_guardados')
                .insert({ plan_id: planId, usuario_id: currentUserId });
            if (error) {
                setIsSaved(prev);
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        }
    };

    const handleJoin = async () => {
        if (!currentUserId || !plan || actionBusy) return;
        setActionBusy(true);
        const estado = resolveJoinEstado({
            requiere_aprobacion: plan.requiere_aprobacion,
            maximo_participantes: plan.maximo_participantes,
            joinedCount,
        });
        const nextMembership = membershipFromJoinEstado(estado);
        const prevMembership = membership;
        const prevCount = joinedCount;
        setMembership(nextMembership);
        if (estado === 'aceptado') setJoinedCount((c) => c + 1);

        const { error } = await supabase.from('participantes').insert({
            plan_id: plan.id,
            usuario_id: currentUserId,
            estado,
        });
        if (error) {
            setMembership(prevMembership);
            setJoinedCount(prevCount);
            Alert.alert(t('feed.error'), t('feed.joinError'));
        } else {
            await loadPlan();
        }
        setActionBusy(false);
    };

    const handleLeave = () => {
        if (!currentUserId || !plan) return;
        const wasJoined = membership === 'joined';
        const wasWaitlist = membership === 'waitlist';
        const title = wasJoined
            ? t('feed.leaveTitle')
            : wasWaitlist
              ? t('card.leaveWaitlistTitle')
              : t('feed.cancelRequestTitle');
        const message = wasJoined
            ? t('feed.leaveMsg')
            : wasWaitlist
              ? t('card.leaveWaitlistMsg')
              : t('feed.cancelRequestMsg');

        Alert.alert(title, message, [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.yes'),
                style: 'destructive',
                onPress: async () => {
                    setActionBusy(true);
                    const prevMembership = membership;
                    const prevCount = joinedCount;
                    setMembership('none');
                    if (wasJoined) setJoinedCount((c) => Math.max(0, c - 1));

                    const { error } = await supabase
                        .from('participantes')
                        .delete()
                        .eq('plan_id', plan.id)
                        .eq('usuario_id', currentUserId);

                    if (error) {
                        setMembership(prevMembership);
                        setJoinedCount(prevCount);
                        Alert.alert(t('feed.error'), t('feed.leaveError'));
                    } else if (wasJoined) {
                        await promoteWaitlist(plan.id);
                        await loadPlan();
                    }
                    setActionBusy(false);
                },
            },
        ]);
    };

    const renderPrimaryAction = () => {
        if (isCreator) {
            return (
                <View style={styles.creatorActions}>
                    <TouchableOpacity
                        style={styles.chatBtn}
                        activeOpacity={0.9}
                        onPress={() => router.push(`/chat/${plan!.id}`)}
                    >
                        <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.chatBtnGradient}>
                            <Ionicons name="chatbubbles" size={22} color="#FFF" />
                            <Text style={styles.chatBtnText}>{t('planDetail.openChat')}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconRoundBtn} onPress={() => router.push({ pathname: '/create-plan', params: { editId: plan!.id } })}>
                        <Ionicons name="create-outline" size={22} color={PRIMARY_DARK} />
                    </TouchableOpacity>
                </View>
            );
        }

        if (membership === 'joined') {
            return (
                <View style={styles.joinedActions}>
                    <TouchableOpacity
                        style={styles.chatBtn}
                        activeOpacity={0.9}
                        onPress={() => router.push(`/chat/${plan!.id}`)}
                    >
                        <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.chatBtnGradient}>
                            <Ionicons name="chatbubbles" size={22} color="#FFF" />
                            <Text style={styles.chatBtnText}>{t('planDetail.openChat')}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.joinedOutlineBtn} onPress={handleLeave} activeOpacity={0.85}>
                        <Ionicons name="checkmark-circle" size={20} color={SUCCESS} />
                        <Text style={styles.joinedOutlineText}>{t('card.joined')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (membership === 'requested') {
            return (
                <TouchableOpacity style={styles.requestedBtn} onPress={handleLeave} activeOpacity={0.85}>
                    <Ionicons name="time" size={20} color="#B45309" />
                    <Text style={styles.requestedBtnText}>{t('card.requested')}</Text>
                </TouchableOpacity>
            );
        }

        if (membership === 'waitlist') {
            return (
                <TouchableOpacity style={styles.waitlistBtn} onPress={handleLeave} activeOpacity={0.85}>
                    <Ionicons name="hourglass" size={20} color={WAITLIST} />
                    <Text style={styles.waitlistBtnText}>{t('card.waitlist')}</Text>
                </TouchableOpacity>
            );
        }

        if (isFull) {
            if (!waitlistOpen) {
                return (
                    <View style={styles.fullClosedBtn}>
                        <Ionicons name="ban" size={20} color={DANGER} />
                        <Text style={styles.fullClosedBtnText}>{t('card.fullClosed')}</Text>
                    </View>
                );
            }
            return (
                <TouchableOpacity style={styles.waitlistJoinBtn} onPress={handleJoin} activeOpacity={0.9} disabled={actionBusy}>
                    <Ionicons name="list" size={20} color="#FFF" />
                    <Text style={styles.waitlistJoinText}>{t('card.joinWaitlist')}</Text>
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoin} activeOpacity={0.9} disabled={actionBusy}>
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.joinBtnGradient}>
                    <Text style={styles.joinBtnText}>{requiresApproval ? t('card.request') : t('card.join')}</Text>
                    <Ionicons name={requiresApproval ? 'shield-checkmark' : 'arrow-forward'} size={20} color="#FFF" />
                </LinearGradient>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={PRIMARY_DARK} />
            </View>
        );
    }

    if (!plan) {
        return (
            <SafeAreaView style={styles.notFoundWrap}>
                <Ionicons name="compass-outline" size={56} color={MUTED} />
                <Text style={styles.notFoundTitle}>{t('planDetail.notFound')}</Text>
                <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
                    <Text style={styles.backLinkText}>{t('common.back')}</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const creatorIsFriend = creator ? friendIds.has(creator.id) : false;
    const ratingLabel =
        creatorStats.numeroValoraciones > 0
            ? t('planDetail.ratingLabel', {
                  score: creatorStats.valoracionMedia.toFixed(1),
                  count: creatorStats.numeroValoraciones,
              })
            : t('planDetail.noReviews');

    return (
        <View style={styles.root}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
            >
                <View style={styles.heroWrap}>
                    <PlanImage
                        source={resolvePlanImageSource(plan.imagen_url)}
                        style={styles.heroImage}
                        priority="high"
                        recyclingKey={plan.id}
                    />
                    <View style={[styles.heroTopBar, { paddingTop: insets.top + 10 }]}>
                        <TouchableOpacity style={styles.glassBtn} onPress={() => router.back()} activeOpacity={0.85}>
                            <Ionicons name="chevron-back" size={24} color="#FFF" />
                        </TouchableOpacity>
                        <View style={styles.heroTopRight}>
                            <TouchableOpacity style={styles.glassBtn} onPress={handleShare} activeOpacity={0.85}>
                                <Ionicons name="share-outline" size={20} color="#FFF" />
                            </TouchableOpacity>
                            {!isCreator && (
                                <TouchableOpacity style={styles.glassBtn} onPress={handleToggleSave} activeOpacity={0.85}>
                                    <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={22} color={isSaved ? '#FCA5A5' : '#FFF'} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                </View>

                <View style={styles.sheet}>
                    <View style={styles.titleBlock}>
                        <View style={styles.categoryChipLight}>
                            <Text style={styles.categoryChipLightText}>{t('cat.' + plan.categoria)}</Text>
                        </View>
                        <Text style={styles.planTitle}>{plan.titulo}</Text>
                        {sportPlan && (
                            <View style={styles.sportChipLight}>
                                <SportIcon sport={sportPlan.tipo} size={16} color={PRIMARY_DARK} />
                                <Text style={styles.sportChipLightText}>{sportPlan.formato ?? t('sport.' + sportPlan.tipo)}</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.dateRow}>
                        <View style={styles.dateCard}>
                            <Ionicons name="calendar" size={20} color={PRIMARY_DARK} />
                            <View style={styles.dateCardText}>
                                <Text style={styles.dateLabel}>{t('planDetail.date')}</Text>
                                <Text style={styles.dateValue}>{dateString}</Text>
                            </View>
                        </View>
                        {timeString ? (
                            <View style={styles.dateCard}>
                                <Ionicons name="time" size={20} color={PRIMARY_DARK} />
                                <View style={styles.dateCardText}>
                                    <Text style={styles.dateLabel}>{t('planDetail.time')}</Text>
                                    <Text style={styles.dateValue}>{timeString}</Text>
                                </View>
                            </View>
                        ) : null}
                    </View>

                    {creator && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>{t('planDetail.creator')}</Text>
                            <View style={[styles.creatorCard, creatorIsFriend && styles.creatorCardFriend]}>
                                <TouchableOpacity
                                    style={styles.creatorMain}
                                    activeOpacity={0.85}
                                    onPress={() => openProfile(creator.id)}
                                >
                                    <View style={[styles.creatorAvatarWrap, creatorIsFriend && styles.creatorAvatarWrapFriend]}>
                                        <ProfileAvatar uri={creator.avatar_url} name={creator.nombre} size={72} recyclingKey={creator.id} />
                                    </View>
                                    <View style={styles.creatorInfo}>
                                        <Text style={styles.creatorLabel}>{t('planDetail.creator')}</Text>
                                        <Text style={[styles.creatorName, creatorIsFriend && styles.creatorNameFriend]}>
                                            {creator.nombre}
                                        </Text>
                                        <View style={styles.ratingRow}>
                                            {renderRatingStars(creatorStats.valoracionMedia, 14)}
                                            <Text style={styles.ratingText}>{ratingLabel}</Text>
                                        </View>
                                    </View>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.historyBtn}
                                    activeOpacity={0.85}
                                    onPress={() => openProfile(creator.id)}
                                >
                                    <Text style={styles.historyBtnText}>{t('planDetail.viewHistory')}</Text>
                                    <Ionicons name="arrow-forward" size={16} color={PRIMARY_DARK} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>{t('planDetail.participants')}</Text>
                            <Text style={styles.participantCount}>
                                {participants.length}/{plan.maximo_participantes}
                            </Text>
                        </View>
                        {participants.length === 0 ? (
                            <View style={styles.emptyParticipants}>
                                <Ionicons name="people-outline" size={28} color={MUTED} />
                                <Text style={styles.emptyParticipantsText}>{t('card.beFirst')}</Text>
                            </View>
                        ) : (
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.participantsScroll}
                            >
                                {participants.map((p) => (
                                    <PersonBubble
                                        key={p.id}
                                        person={p}
                                        isFriend={friendIds.has(p.id)}
                                        subtitle={p.isCreator ? t('planDetail.creator') : undefined}
                                        onPress={() => openProfile(p.id)}
                                    />
                                ))}
                            </ScrollView>
                        )}
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('planDetail.about')}</Text>
                        <Text style={styles.description}>{plan.descripcion?.trim() || t('card.noDescription')}</Text>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="location" size={18} color={PRIMARY_DARK} />
                            <Text style={styles.sectionTitle}>{t('planDetail.location')}</Text>
                        </View>
                        <Text style={styles.locationName}>{plan.nombre_ubicacion || t('card.location')}</Text>
                        <TouchableOpacity
                            style={styles.mapCard}
                            activeOpacity={0.92}
                            onPress={() => setMapExpanded(true)}
                        >
                            <MapView
                                style={styles.map}
                                scrollEnabled={false}
                                zoomEnabled={false}
                                pitchEnabled={false}
                                rotateEnabled={false}
                                initialRegion={{
                                    latitude: lat,
                                    longitude: lng,
                                    latitudeDelta: 0.008,
                                    longitudeDelta: 0.008,
                                }}
                            >
                                <Marker coordinate={{ latitude: lat, longitude: lng }} />
                            </MapView>
                            <View style={styles.mapTapOverlay} pointerEvents="none">
                                <View style={styles.mapExpandPill}>
                                    <Ionicons name="expand" size={16} color="#FFF" />
                                    <Text style={styles.mapExpandText}>{t('planDetail.expandMap')}</Text>
                                </View>
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                {renderPrimaryAction()}
            </View>

            <Modal visible={mapExpanded} animationType="slide" onRequestClose={() => setMapExpanded(false)}>
                <View style={styles.fullMapRoot}>
                    <StatusBar barStyle="dark-content" />
                    <MapView
                        style={styles.fullMap}
                        scrollEnabled
                        zoomEnabled
                        pitchEnabled
                        rotateEnabled
                        showsUserLocation
                        showsMyLocationButton={Platform.OS === 'android'}
                        initialRegion={{
                            latitude: lat,
                            longitude: lng,
                            latitudeDelta: 0.012,
                            longitudeDelta: 0.012,
                        }}
                    >
                        <Marker coordinate={{ latitude: lat, longitude: lng }} title={plan.titulo} description={plan.nombre_ubicacion ?? undefined} />
                    </MapView>
                    <View style={[styles.fullMapTopBar, { paddingTop: insets.top + 8 }]}>
                        <TouchableOpacity style={styles.fullMapCloseBtn} onPress={() => setMapExpanded(false)} activeOpacity={0.85}>
                            <Ionicons name="close" size={26} color={INK} />
                        </TouchableOpacity>
                    </View>
                    <View style={[styles.fullMapFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                        <View style={styles.fullMapFooterCard}>
                            <Ionicons name="location" size={20} color={PRIMARY_DARK} />
                            <View style={styles.fullMapFooterText}>
                                <Text style={styles.fullMapFooterTitle} numberOfLines={1}>{plan.nombre_ubicacion || t('card.location')}</Text>
                                <Text style={styles.fullMapFooterSub} numberOfLines={1}>{plan.titulo}</Text>
                            </View>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F1F5F9' },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
    notFoundWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9', padding: 24 },
    notFoundTitle: { fontSize: 18, fontWeight: '700', color: INK, marginTop: 16, textAlign: 'center' },
    backLink: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10 },
    backLinkText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 16 },

    heroWrap: { height: HERO_H, backgroundColor: '#E2E8F0' },
    heroImage: { width: '100%', height: '100%' },
    heroTopBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        zIndex: 2,
    },
    heroTopRight: { flexDirection: 'row', gap: 10 },
    glassBtn: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: 'rgba(15,42,74,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
    },

    sheet: {
        backgroundColor: SURFACE,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 28,
        paddingHorizontal: 20,
        minHeight: 200,
        marginTop: -16,
        ...Platform.select({
            ios: { shadowColor: '#0F2A4A', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12 },
            android: { elevation: 8 },
        }),
    },
    titleBlock: { marginBottom: 20 },
    categoryChipLight: {
        alignSelf: 'flex-start',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 20,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    categoryChipLightText: { color: PRIMARY_DARK, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
    planTitle: { fontSize: 26, fontWeight: '800', color: INK, lineHeight: 32, letterSpacing: -0.4 },
    sportChipLight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 12,
        alignSelf: 'flex-start',
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    sportChipLightText: { color: INK, fontSize: 13, fontWeight: '600' },

    dateRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
    dateCard: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    dateCardText: { flex: 1 },
    dateLabel: { fontSize: 11, fontWeight: '600', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
    dateValue: { fontSize: 14, fontWeight: '700', color: INK, marginTop: 2 },

    section: { marginTop: 28 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    sectionTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
    locationName: { fontSize: 15, color: MUTED, marginBottom: 12, fontWeight: '500' },
    mapCard: {
        height: 180,
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: BORDER,
    },
    map: { width: '100%', height: '100%' },
    mapTapOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 12,
        backgroundColor: 'rgba(15,42,74,0.08)',
    },
    mapExpandPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(15,42,74,0.72)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    mapExpandText: { color: '#FFF', fontSize: 13, fontWeight: '700' },

    fullMapRoot: { flex: 1, backgroundColor: '#000' },
    fullMap: { ...StyleSheet.absoluteFillObject },
    fullMapTopBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        zIndex: 2,
    },
    fullMapCloseBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: SURFACE,
        alignItems: 'center',
        justifyContent: 'center',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6 },
            android: { elevation: 4 },
        }),
    },
    fullMapFooter: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
    },
    fullMapFooterCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: SURFACE,
        borderRadius: 16,
        padding: 16,
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8 },
            android: { elevation: 6 },
        }),
    },
    fullMapFooterText: { flex: 1 },
    fullMapFooterTitle: { fontSize: 16, fontWeight: '800', color: INK },
    fullMapFooterSub: { fontSize: 13, color: MUTED, marginTop: 2 },

    creatorCard: {
        marginTop: 12,
        backgroundColor: '#FFFBEB',
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: '#FDE68A',
        overflow: 'hidden',
    },
    creatorCardFriend: {
        backgroundColor: FRIEND_BG,
        borderColor: FRIEND_BORDER,
    },
    creatorMain: { flexDirection: 'row', padding: 16, gap: 14, alignItems: 'center' },
    creatorAvatarWrap: {
        borderRadius: 40,
        borderWidth: 3,
        borderColor: GOLD,
        padding: 2,
    },
    creatorAvatarWrapFriend: { borderColor: FRIEND },
    creatorInfo: { flex: 1 },
    creatorLabel: { fontSize: 11, fontWeight: '700', color: GOLD, textTransform: 'uppercase', letterSpacing: 0.5 },
    creatorName: { fontSize: 20, fontWeight: '800', color: INK, marginTop: 2 },
    creatorNameFriend: { color: '#047857' },
    ratingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    ratingText: { fontSize: 12, color: MUTED, fontWeight: '500' },
    historyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.06)',
        backgroundColor: 'rgba(255,255,255,0.5)',
    },
    historyBtnText: { fontSize: 14, fontWeight: '700', color: PRIMARY_DARK },

    participantCount: { fontSize: 14, fontWeight: '700', color: MUTED },
    participantsScroll: { paddingVertical: 4, gap: 16, paddingRight: 8 },
    personBubble: { width: 80, alignItems: 'center' },
    personAvatarRing: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: BORDER,
        backgroundColor: SURFACE,
    },
    personAvatarRingFriend: { borderColor: FRIEND, backgroundColor: FRIEND_BG },
    creatorStar: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: SURFACE,
    },
    personName: { fontSize: 12, fontWeight: '700', color: INK, marginTop: 8, textAlign: 'center', maxWidth: 76 },
    personNameFriend: { color: '#047857' },
    personSubtitle: { fontSize: 10, color: MUTED, marginTop: 2 },
    personSubtitleFriend: { color: FRIEND },
    friendPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        marginTop: 4,
        backgroundColor: FRIEND_BG,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: FRIEND_BORDER,
    },
    friendPillText: { fontSize: 9, fontWeight: '700', color: FRIEND },

    emptyParticipants: {
        alignItems: 'center',
        paddingVertical: 24,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        borderStyle: 'dashed',
    },
    emptyParticipantsText: { marginTop: 8, color: MUTED, fontWeight: '600' },

    description: { fontSize: 15, lineHeight: 24, color: '#334155', marginTop: 8 },

    bottomBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 20,
        paddingTop: 16,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderTopWidth: 1,
        borderTopColor: BORDER,
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 8 },
            android: { elevation: 12 },
        }),
    },
    joinBtn: { borderRadius: 16, overflow: 'hidden' },
    joinBtnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 18,
        paddingHorizontal: 24,
    },
    joinBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
    waitlistJoinBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: WAITLIST,
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
    },
    waitlistJoinText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
    fullClosedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#FEF2F2',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#FECACA',
    },
    fullClosedBtnText: { color: DANGER, fontSize: 16, fontWeight: '800' },
    requestedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FFFBEB',
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#FDE68A',
    },
    requestedBtnText: { color: '#B45309', fontSize: 16, fontWeight: '800' },
    waitlistBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#F5F3FF',
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#DDD6FE',
    },
    waitlistBtnText: { color: WAITLIST, fontSize: 16, fontWeight: '800' },
    joinedActions: { gap: 12 },
    chatBtn: { borderRadius: 16, overflow: 'hidden' },
    chatBtnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 18,
        paddingHorizontal: 28,
    },
    chatBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
    joinedOutlineBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#BBF7D0',
        backgroundColor: '#F0FDF4',
    },
    joinedOutlineText: { color: SUCCESS, fontSize: 15, fontWeight: '700' },
    creatorActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    iconRoundBtn: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
});
