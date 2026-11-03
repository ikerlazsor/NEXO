import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import type { PlanInviteCardPayload } from '../lib/chatPlanInviteCard';
import { resolvePlanImageSource } from '../lib/categories';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { Alert } from '../lib/nexoAlert';
import { useT } from '../lib/i18n';
import {
    acceptPlanInvite,
    rejectPlanInvite,
    reopenPlanInvite,
    type PlanInvite,
} from '../lib/planInvites';
import { broadcastPlanMembership } from '../lib/membershipBroadcast';
import {
    peekInviteCardStatus,
    purgeInviteCardMessage,
    resolveInviteCardStatus,
    setInviteCardStatus,
    subscribeInviteCardStatus,
    type InviteCardUiStatus,
} from '../lib/planInviteCardStatus';
import { PlanImage } from './PlanImage';
import { ProfileAvatar } from './ProfileAvatar';
import { supabase } from '../lib/supabase';

type Props = {
    payload: PlanInviteCardPayload;
    messageId?: string;
    currentUserId: string | null;
    onOpenPlan?: (planId: string) => void;
    onGone?: () => void;
};

const MAX_BUBBLES = 5;

export function PlanInviteCardMessage({
    payload,
    messageId,
    currentUserId,
    onOpenPlan,
    onGone,
}: Props) {
    const { t } = useT();
    const cached = peekInviteCardStatus(payload.planId, currentUserId);
    const [status, setStatus] = useState<InviteCardUiStatus>(
        () =>
            cached?.status ??
            (currentUserId && currentUserId === payload.inviterId ? 'self' : 'loading'),
    );
    const [invite, setInvite] = useState<PlanInvite | null>(() => cached?.invite ?? null);
    const [busy, setBusy] = useState(false);
    const [coverKey, setCoverKey] = useState<string | null>(
        () => cached?.coverUrl ?? payload.imagenUrl ?? null,
    );
    const [seats, setSeats] = useState<{ joined: number | null; max: number | null }>(() => ({
        joined: cached?.joinedCount ?? null,
        max: cached?.maxCount ?? null,
    }));
    const [inviterAvatar, setInviterAvatar] = useState<string | null>(payload.inviterAvatarUrl ?? null);
    const [members, setMembers] = useState(payload.members ?? []);
    const goneNotifiedRef = useRef(false);
    const onGoneRef = useRef(onGone);
    onGoneRef.current = onGone;

    const coverSource = useMemo(() => resolvePlanImageSource(coverKey), [coverKey]);

    // Debe ser idempotente: marcar 'gone' avisa al store y ese aviso vuelve aquí.
    const markGone = useCallback(() => {
        if (goneNotifiedRef.current) return;
        goneNotifiedRef.current = true;
        setStatus('gone');
        setInvite(null);
        setInviteCardStatus(payload.planId, currentUserId, {
            status: 'gone',
            invite: null,
            coverUrl: null,
        });
        if (messageId) {
            void purgeInviteCardMessage({
                messageId,
                planId: payload.planId,
                currentUserId,
            });
        }
        onGoneRef.current?.();
    }, [currentUserId, messageId, payload.planId]);

    const applySnap = useCallback(
        (snap: {
            status: InviteCardUiStatus;
            invite: PlanInvite | null;
            coverUrl: string | null;
            joinedCount?: number | null;
            maxCount?: number | null;
        }) => {
            if (snap.status === 'gone') {
                markGone();
                return;
            }
            setStatus(snap.status);
            setInvite(snap.invite);
            if (snap.coverUrl) setCoverKey(snap.coverUrl);
            if (snap.joinedCount !== undefined || snap.maxCount !== undefined) {
                setSeats({ joined: snap.joinedCount ?? null, max: snap.maxCount ?? null });
            }
        },
        [markGone],
    );

    const refresh = useCallback(async () => {
        const snap = await resolveInviteCardStatus({
            planId: payload.planId,
            inviterId: payload.inviterId,
            currentUserId,
            imagenUrlHint: payload.imagenUrl ?? coverKey,
        });
        applySnap(snap);
        // coverKey no en deps: evita bucle al hidratar portada
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applySnap, currentUserId, payload.imagenUrl, payload.inviterId, payload.planId]);

    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    const markGoneRef = useRef(markGone);
    markGoneRef.current = markGone;

    useEffect(() => {
        const peek = peekInviteCardStatus(payload.planId, currentUserId);
        if (peek && Date.now() - peek.resolvedAt < 10_000) {
            applySnap(peek);
            return;
        }
        void refresh();
    }, [applySnap, currentUserId, payload.planId, refresh]);

    useEffect(() => {
        return subscribeInviteCardStatus((planId) => {
            if (planId !== payload.planId) return;
            const snap = peekInviteCardStatus(payload.planId, currentUserId);
            if (snap) applySnap(snap);
        });
    }, [applySnap, currentUserId, payload.planId]);

    useEffect(() => {
        if (!currentUserId) return;
        const channel = supabase
            .channel(`invite-card-${payload.planId}-${currentUserId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'invitaciones_planes',
                    filter: `invitado_id=eq.${currentUserId}`,
                },
                () => {
                    if (goneNotifiedRef.current) return;
                    void refreshRef.current();
                },
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'participantes',
                    filter: `usuario_id=eq.${currentUserId}`,
                },
                () => {
                    if (goneNotifiedRef.current) return;
                    void refreshRef.current();
                },
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'participantes',
                    filter: `plan_id=eq.${payload.planId}`,
                },
                () => {
                    if (goneNotifiedRef.current) return;
                    void refreshRef.current();
                },
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'planes',
                    filter: `id=eq.${payload.planId}`,
                },
                () => {
                    markGoneRef.current();
                },
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
        // Deps estables: si no, cada render recreaba el canal realtime.
    }, [currentUserId, payload.planId]);

    useEffect(() => {
        if (payload.inviterAvatarUrl) return;
        let cancelled = false;
        void supabase
            .from('perfiles')
            .select('avatar_url')
            .eq('id', payload.inviterId)
            .maybeSingle()
            .then(({ data }) => {
                if (cancelled || !data?.avatar_url) return;
                setInviterAvatar(data.avatar_url as string);
            });
        return () => {
            cancelled = true;
        };
    }, [payload.inviterAvatarUrl, payload.inviterId]);

    useEffect(() => {
        if ((payload.members?.length ?? 0) > 0) return;
        let cancelled = false;
        void (async () => {
            const { data } = await supabase
                .from('participantes')
                .select('usuario_id, perfiles:usuario_id ( id, nombre, avatar_url )')
                .eq('plan_id', payload.planId)
                .eq('estado', 'aceptado')
                .limit(12);
            if (cancelled || !data?.length) return;
            setMembers(
                data
                    .map((row) => {
                        const perfil = Array.isArray(row.perfiles) ? row.perfiles[0] : row.perfiles;
                        if (!perfil?.id) return null;
                        return {
                            id: String(perfil.id),
                            nombre: String((perfil.nombre as string) || 'Nexo'),
                            avatarUrl: (perfil.avatar_url as string | null) ?? null,
                        };
                    })
                    .filter(Boolean) as typeof members,
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [payload.members, payload.planId]);

    useEffect(() => {
        if (status === 'gone') markGone();
    }, [status, markGone]);

    if (status === 'gone') return null;

    const onAccept = async () => {
        if (!invite || !currentUserId || busy) return;
        setBusy(true);
        hapticLight();
        try {
            const { error, estado, alreadyMember } = await acceptPlanInvite(invite, currentUserId);
            if (error) {
                // Reglas del plan: sin aviso el botón parecería roto.
                if (error === 'kicked') {
                    setStatus('none');
                    Alert.alert(t('feed.error'), t('plan.kickedCannotJoin'));
                } else if (error === 'gender_restricted') {
                    setStatus('none');
                    Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
                } else if (error === 'full') {
                    setStatus('full');
                    Alert.alert(t('feed.error'), t('friends.inviteFull'));
                } else if (error === 'limit') {
                    Alert.alert(t('feed.error'), t('feed.planLimitReached', { max: 5 }));
                }
                return;
            }
            hapticSuccess();
            const nextStatus = estado === 'lista_espera' ? 'waitlist' : 'accepted';
            setStatus(nextStatus);
            setInvite(null);
            setInviteCardStatus(payload.planId, currentUserId, {
                status: nextStatus,
                invite: null,
            });
            const membership =
                estado === 'pendiente' ? 'requested' : estado === 'lista_espera' ? 'waitlist' : 'joined';
            broadcastPlanMembership(payload.planId, membership, {
                userId: currentUserId,
                bumpJoined: !alreadyMember && estado === 'aceptado',
                clearInvite: true,
                invalidateFriends: true,
            });
        } finally {
            setBusy(false);
        }
    };

    const onReject = async () => {
        if (!invite || busy) return;
        setBusy(true);
        hapticLight();
        try {
            const { error } = await rejectPlanInvite(invite.id);
            if (error) return;
            setStatus('rejected');
            setInviteCardStatus(payload.planId, currentUserId, {
                status: 'rejected',
                invite,
            });
            broadcastPlanMembership(payload.planId, 'none', {
                userId: currentUserId ?? undefined,
                clearInvite: true,
                invalidateFriends: true,
            });
        } finally {
            setBusy(false);
        }
    };

    const onUndoReject = async () => {
        if (!invite || busy) return;
        setBusy(true);
        hapticLight();
        try {
            const { error } = await reopenPlanInvite(invite.id);
            if (error) return;
            hapticSuccess();
            const reopened = { ...invite, estado: 'pendiente' };
            const noSeats = seats.max != null && (seats.joined ?? 0) >= seats.max;
            setInvite(reopened);
            setStatus(noSeats ? 'full' : 'pending');
            setInviteCardStatus(payload.planId, currentUserId, {
                status: noSeats ? 'full' : 'pending',
                invite: reopened,
            });
        } finally {
            setBusy(false);
        }
    };

    const shownMembers = members.slice(0, MAX_BUBBLES);
    const extraMembers = Math.max(0, members.length - shownMembers.length);

    return (
        <View style={styles.wrap}>
            <View style={styles.card}>
                <TouchableOpacity
                    activeOpacity={0.94}
                    onPress={() => onOpenPlan?.(payload.planId)}
                    style={styles.hero}
                >
                    <PlanImage
                        source={coverSource}
                        style={StyleSheet.absoluteFillObject}
                        recyclingKey={`invite-cover-${payload.planId}`}
                        priority="normal"
                    />
                    <LinearGradient
                        colors={[
                            'rgba(15,23,42,0.00)',
                            'rgba(15,23,42,0.30)',
                            'rgba(15,23,42,0.88)',
                        ]}
                        locations={[0, 0.45, 1]}
                        style={StyleSheet.absoluteFillObject}
                    />
                    <View style={styles.heroTop}>
                        <View style={styles.badge}>
                            <Ionicons name="sparkles" size={13} color="#FFF" />
                            <Text style={styles.badgeText}>{t('invite.groupCardBadge')}</Text>
                        </View>
                        {seats.max != null ? (
                            <View style={styles.seatsPill}>
                                <Ionicons name="people" size={13} color="#FFF" />
                                <Text style={styles.badgeText}>
                                    {`${seats.joined ?? 0}/${seats.max}`}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                    <Text style={styles.heroTitle} numberOfLines={2}>
                        {payload.titulo}
                    </Text>
                </TouchableOpacity>

                <View style={styles.body}>
                    <View style={styles.inviterRow}>
                        <ProfileAvatar
                            uri={inviterAvatar}
                            name={payload.inviterName}
                            size={40}
                            recyclingKey={payload.inviterId}
                            priority="low"
                        />
                        <View style={styles.inviterCopy}>
                            <Text style={styles.inviterLabel} numberOfLines={1}>
                                {t('invite.groupCardFrom', { name: payload.inviterName })}
                            </Text>
                            {(payload.whenLabel || payload.place) && (
                                <Text style={styles.metaLine} numberOfLines={1}>
                                    {[payload.whenLabel, payload.place].filter(Boolean).join(' · ')}
                                </Text>
                            )}
                        </View>
                    </View>

                    {shownMembers.length > 0 ? (
                        <View style={styles.membersRow}>
                            {shownMembers.map((m, idx) => (
                                <View
                                    key={m.id}
                                    style={[
                                        styles.memberBubble,
                                        { marginLeft: idx === 0 ? 0 : -8, zIndex: shownMembers.length - idx },
                                    ]}
                                >
                                    <ProfileAvatar
                                        uri={m.avatarUrl}
                                        name={m.nombre}
                                        size={32}
                                        recyclingKey={m.id}
                                        priority="low"
                                    />
                                </View>
                            ))}
                            {extraMembers > 0 ? (
                                <View style={[styles.memberMore, { marginLeft: -8 }]}>
                                    <Text style={styles.memberMoreText}>+{extraMembers}</Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}

                    {status === 'loading' ? (
                        <View style={styles.actionsPlaceholder}>
                            <ActivityIndicator color="#2563EB" />
                        </View>
                    ) : status === 'pending' ? (
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={[styles.btn, styles.btnGhost]}
                                onPress={() => void onReject()}
                                disabled={busy}
                                activeOpacity={0.88}
                            >
                                <Text style={styles.btnGhostText}>{t('invite.groupCardReject')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.btnFlex}
                                onPress={() => void onAccept()}
                                disabled={busy}
                                activeOpacity={0.88}
                            >
                                <LinearGradient
                                    colors={['#3B82F6', '#1D4ED8']}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={[styles.btn, styles.btnSolid]}
                                >
                                    {busy ? (
                                        <ActivityIndicator color="#FFF" />
                                    ) : (
                                        <>
                                            <Ionicons name="hand-right" size={16} color="#FFF" />
                                            <Text style={styles.btnSolidText}>
                                                {t('invite.groupCardJoin')}
                                            </Text>
                                        </>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    ) : status === 'full' ? (
                        <>
                            <View style={styles.fullNote}>
                                <Ionicons name="lock-closed" size={13} color="#B45309" />
                                <Text style={styles.fullNoteText}>
                                    {t('invite.groupCardFull', {
                                        joined: seats.joined ?? 0,
                                        max: seats.max ?? 0,
                                    })}
                                </Text>
                            </View>
                            <View style={styles.actions}>
                                <TouchableOpacity
                                    style={[styles.btn, styles.btnGhost]}
                                    onPress={() => void onReject()}
                                    disabled={busy}
                                    activeOpacity={0.88}
                                >
                                    <Text style={styles.btnGhostText}>
                                        {t('invite.groupCardReject')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.btn, styles.btnWaitlist]}
                                    onPress={() => void onAccept()}
                                    disabled={busy}
                                    activeOpacity={0.88}
                                >
                                    {busy ? (
                                        <ActivityIndicator color="#FFF" />
                                    ) : (
                                        <>
                                            <Ionicons name="hourglass" size={15} color="#FFF" />
                                            <Text style={styles.btnSolidText}>
                                                {t('invite.groupCardWaitlistJoin')}
                                            </Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : status === 'rejected' ? (
                        <View style={styles.actions}>
                            <View style={[styles.statusPill, styles.statusPillFlex]}>
                                <Ionicons name="close-circle" size={14} color="#2563EB" />
                                <Text style={styles.statusText}>{t('invite.groupCardRejected')}</Text>
                            </View>
                            <TouchableOpacity
                                style={[styles.btn, styles.btnSolid]}
                                onPress={() => void onUndoReject()}
                                disabled={busy || !invite}
                                activeOpacity={0.88}
                            >
                                {busy ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.btnSolidText}>
                                        {t('invite.groupCardUndoReject')}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    ) : status === 'self' ? null : (
                        <View style={styles.statusPill}>
                            <Ionicons
                                name={
                                    status === 'accepted'
                                        ? 'checkmark-circle'
                                        : status === 'waitlist'
                                          ? 'hourglass'
                                          : 'open-outline'
                                }
                                size={14}
                                color="#2563EB"
                            />
                            <Text style={styles.statusText}>
                                {status === 'accepted'
                                    ? t('invite.groupCardJoined')
                                    : status === 'waitlist'
                                      ? t('invite.groupCardWaitlisted')
                                      : t('invite.groupCardOpen')}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignSelf: 'center',
        width: '96%',
        maxWidth: 430,
        marginVertical: 14,
        minHeight: 320,
    },
    card: {
        borderRadius: 28,
        overflow: 'hidden',
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: 'rgba(37,99,235,0.24)',
        elevation: 12,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.26,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 12 },
    },
    hero: {
        height: 188,
        justifyContent: 'flex-end',
        padding: 16,
    },
    heroTop: {
        position: 'absolute',
        top: 14,
        left: 14,
        right: 14,
        flexDirection: 'row',
        alignItems: 'center',
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#2563EB',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        elevation: 4,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
    },
    badgeText: {
        color: '#FFF',
        fontSize: 12.5,
        fontWeight: '900',
        letterSpacing: 0.3,
    },
    seatsPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginLeft: 'auto',
        backgroundColor: 'rgba(15,23,42,0.58)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 999,
    },
    btnWaitlist: {
        backgroundColor: '#B45309',
        elevation: 5,
        shadowColor: '#92400E',
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
    },
    fullNote: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: 'rgba(180,83,9,0.22)',
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 999,
    },
    fullNoteText: { color: '#92400E', fontWeight: '800', fontSize: 12.5 },
    statusPillFlex: { flex: 1, justifyContent: 'center' },
    heroTitle: {
        color: '#FFF',
        fontSize: 25,
        fontWeight: '900',
        lineHeight: 29,
        letterSpacing: -0.3,
        textShadowColor: 'rgba(0,0,0,0.45)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
    },
    body: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 16,
        gap: 13,
        backgroundColor: '#F4F9FF',
        borderTopWidth: 1,
        borderTopColor: 'rgba(37,99,235,0.12)',
    },
    inviterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    inviterCopy: { flex: 1, minWidth: 0, gap: 2 },
    inviterLabel: {
        color: '#0F2A4A',
        fontSize: 14.5,
        fontWeight: '800',
    },
    metaLine: {
        color: '#5B7391',
        fontSize: 13,
        fontWeight: '600',
    },
    membersRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 2,
    },
    memberBubble: {
        borderWidth: 2,
        borderColor: '#FFF',
        borderRadius: 999,
    },
    memberMore: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    memberMoreText: { color: '#1E3A8A', fontSize: 11, fontWeight: '800' },
    actions: {
        flexDirection: 'row',
        gap: 10,
        minHeight: 52,
    },
    actionsPlaceholder: {
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnFlex: { flex: 1 },
    btn: {
        flex: 1,
        height: 52,
        borderRadius: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
    },
    btnGhost: {
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: '#BFDBFE',
    },
    btnGhostText: { color: '#1E3A8A', fontWeight: '800', fontSize: 15 },
    btnSolid: {
        backgroundColor: '#2563EB',
        elevation: 6,
        shadowColor: '#1D4ED8',
        shadowOpacity: 0.42,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
    },
    btnSolidText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
    statusPill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#DBEAFE',
        borderWidth: 1,
        borderColor: 'rgba(37,99,235,0.18)',
        paddingHorizontal: 13,
        paddingVertical: 8,
        borderRadius: 999,
        minHeight: 34,
    },
    statusText: { color: '#1E40AF', fontWeight: '800', fontSize: 13 },
});
