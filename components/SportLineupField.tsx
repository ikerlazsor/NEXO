import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '../lib/i18n';
import {
    GENERIC_TEAM_COLORS,
    TEAM_BORDER_COLORS,
    TEAM_CRESTS,
    getCourtStyle,
    getFormation,
    type DeporteFormato,
    type DeporteTipo,
    type Slot,
} from '../lib/sportFormations';
import { supabase } from '../lib/supabase';

const BUBBLE = 46;

interface Occupant {
    equipo: number;
    posicion: number;
    usuario_id: string;
    nombre: string;
    avatar_url: string | null;
}

interface Props {
    planId: string;
    sportType: DeporteTipo;
    formato: DeporteFormato;
    currentUserId: string | null;
    canPlay: boolean;
    onRequireJoin: () => void;
    router: { push: (opts: { pathname: string; params: { id: string } }) => void };
}

const avatarFallback = (name?: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'N')}&background=4DA6FF&color=fff`;

/** Equipo A abajo, equipo B arriba (espejado a la derecha). */
function mapSlotPosition(equipo: number, slot: Slot) {
    if (equipo === 0) {
        return { x: slot.x, y: 0.52 + slot.y * 0.46 };
    }
    return { x: 1 - slot.x, y: (1 - slot.y) * 0.48 };
}

export function SportLineupField({
    planId,
    sportType,
    formato,
    currentUserId,
    canPlay,
    onRequireJoin,
    router,
}: Props) {
    const { t } = useT();
    const [occupants, setOccupants] = useState<Occupant[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const slots = getFormation(sportType, formato);
    const court = getCourtStyle(sportType);
    const useCrests = sportType === 'futbol';

    const fetchLineup = useCallback(async () => {
        const { data } = await supabase
            .from('alineaciones')
            .select('equipo, posicion, usuario_id, perfiles:usuario_id(nombre, avatar_url)')
            .eq('plan_id', planId);
        const mapped: Occupant[] = (data || []).map((r: {
            equipo: number;
            posicion: number;
            usuario_id: string;
            perfiles?: { nombre?: string; avatar_url?: string | null } | null;
        }) => ({
            equipo: r.equipo,
            posicion: r.posicion,
            usuario_id: r.usuario_id,
            nombre: r.perfiles?.nombre || 'Jugador',
            avatar_url: r.perfiles?.avatar_url ?? null,
        }));
        setOccupants(mapped);
        setLoading(false);
    }, [planId]);

    useEffect(() => {
        fetchLineup();
        const channel = supabase
            .channel(`lineup:${planId}:${Math.random().toString(36).slice(2, 8)}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'alineaciones', filter: `plan_id=eq.${planId}` },
                () => fetchLineup()
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [planId, fetchLineup]);

    const getOccupant = (equipo: number, posicion: number) =>
        occupants.find((o) => o.equipo === equipo && o.posicion === posicion);

    const mySlot = currentUserId ? occupants.find((o) => o.usuario_id === currentUserId) : undefined;

    const handleTap = async (equipo: number, posicion: number) => {
        if (busy || !currentUserId) return;
        const occ = getOccupant(equipo, posicion);

        if (occ) {
            if (occ.usuario_id === currentUserId) {
                setBusy(true);
                await supabase.from('alineaciones').delete().eq('plan_id', planId).eq('usuario_id', currentUserId);
                await fetchLineup();
                setBusy(false);
            } else {
                router.push({ pathname: '/user-profile/[id]', params: { id: occ.usuario_id } });
            }
            return;
        }

        if (!canPlay) {
            onRequireJoin();
            return;
        }

        setBusy(true);
        if (mySlot) {
            await supabase.from('alineaciones').delete().eq('plan_id', planId).eq('usuario_id', currentUserId);
        }
        await supabase.from('alineaciones').insert({ plan_id: planId, equipo, posicion, usuario_id: currentUserId });
        await fetchLineup();
        setBusy(false);
    };

    const teamBorder = (equipo: number) =>
        useCrests ? TEAM_BORDER_COLORS[equipo] : GENERIC_TEAM_COLORS[equipo];

    const renderBubble = (equipo: number, posicion: number, slot: Slot) => {
        const { x, y } = mapSlotPosition(equipo, slot);
        const occ = getOccupant(equipo, posicion);
        const isMe = occ?.usuario_id === currentUserId;
        const color = teamBorder(equipo);
        return (
            <TouchableOpacity
                key={`${equipo}-${posicion}`}
                activeOpacity={0.8}
                onPress={() => handleTap(equipo, posicion)}
                style={[
                    styles.bubble,
                    {
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        borderColor: color,
                        backgroundColor: occ ? '#FFF' : 'rgba(255,255,255,0.18)',
                        borderStyle: occ ? 'solid' : 'dashed',
                    },
                ]}
            >
                {occ ? (
                    <>
                        <Image source={{ uri: occ.avatar_url || avatarFallback(occ.nombre) }} style={styles.bubbleAvatar} />
                        {isMe && (
                            <View style={[styles.meDot, { backgroundColor: color }]}>
                                <Ionicons name="checkmark" size={9} color="#FFF" />
                            </View>
                        )}
                    </>
                ) : (
                    <Ionicons name="add" size={22} color="#FFF" />
                )}
                <Text style={styles.bubbleLabel} numberOfLines={1}>
                    {occ ? occ.nombre.split(' ')[0] : slot.label}
                </Text>
            </TouchableOpacity>
        );
    };

    const lineColor = court.lineColor;

    const renderCourtLines = () => {
        if (court.courtType === 'football') {
            return (
                <>
                    <View style={[styles.centerLine, { backgroundColor: lineColor }]} />
                    <View style={[styles.centerCircle, { borderColor: lineColor }]} />
                    <View style={[styles.goalBox, { borderColor: lineColor, top: -1 }]} />
                    <View style={[styles.goalBox, { borderColor: lineColor, bottom: -1 }]} />
                </>
            );
        }

        if (court.courtType === 'basketball') {
            return (
                <>
                    <View style={[styles.centerLine, { backgroundColor: lineColor }]} />
                    <View style={[styles.halfArc, styles.halfArcTop, { borderColor: lineColor }]} />
                    <View style={[styles.halfArc, styles.halfArcBottom, { borderColor: lineColor }]} />
                    <View style={[styles.keyBox, styles.keyBoxTop, { borderColor: lineColor }]} />
                    <View style={[styles.keyBox, styles.keyBoxBottom, { borderColor: lineColor }]} />
                </>
            );
        }

        return (
            <>
                <View style={[styles.centerLine, { backgroundColor: lineColor }]} />
                <View style={[styles.serviceLine, { top: '20%', backgroundColor: lineColor }]} />
                <View style={[styles.serviceLine, { bottom: '20%', backgroundColor: lineColor }]} />
            </>
        );
    };

    const team0Count = occupants.filter((o) => o.equipo === 0).length;
    const team1Count = occupants.filter((o) => o.equipo === 1).length;

    return (
        <View>
            <View style={styles.teamsHeader}>
                <View style={[styles.teamChip, styles.teamChipLeft]}>
                    {useCrests ? (
                        <Image source={TEAM_CRESTS[0]} style={styles.teamCrest} />
                    ) : (
                        <View style={[styles.teamDot, { backgroundColor: GENERIC_TEAM_COLORS[0] }]} />
                    )}
                    <Text style={styles.teamChipText}>
                        {useCrests ? t('futbol.teamA') : t('sport.teamA')} {team0Count}/{slots.length}
                    </Text>
                </View>
                <Text style={styles.formatBadge}>{formato}</Text>
                <View style={[styles.teamChip, styles.teamChipRight]}>
                    {useCrests ? (
                        <Image source={TEAM_CRESTS[1]} style={styles.teamCrest} />
                    ) : (
                        <View style={[styles.teamDot, { backgroundColor: GENERIC_TEAM_COLORS[1] }]} />
                    )}
                    <Text style={[styles.teamChipText, styles.teamChipTextRight]}>
                        {useCrests ? t('futbol.teamB') : t('sport.teamB')} {team1Count}/{slots.length}
                    </Text>
                </View>
            </View>

            {!canPlay && (
                <View style={styles.joinHint}>
                    <Ionicons name="lock-closed" size={14} color="#B45309" />
                    <Text style={styles.joinHintText}>{t('futbol.joinFirst')}</Text>
                </View>
            )}

            <View
                style={[
                    styles.field,
                    {
                        backgroundColor: court.backgroundColor,
                        borderColor: court.borderColor,
                        aspectRatio: 1 / court.aspectRatio,
                    },
                ]}
            >
                {renderCourtLines()}
                {slots.map((s, i) => renderBubble(0, i, s))}
                {slots.map((s, i) => renderBubble(1, i, s))}
                {loading && (
                    <View style={styles.fieldLoading}>
                        <ActivityIndicator color="#FFF" />
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    teamsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    teamChip: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
    teamChipLeft: { justifyContent: 'flex-start' },
    teamChipRight: { justifyContent: 'flex-end' },
    teamCrest: { width: 26, height: 26, resizeMode: 'contain' },
    teamDot: { width: 12, height: 12, borderRadius: 6 },
    teamChipText: { fontSize: 12, fontWeight: '800', color: '#0F2A4A', flexShrink: 1 },
    teamChipTextRight: { textAlign: 'right' },
    formatBadge: {
        fontSize: 13,
        fontWeight: '900',
        color: '#0F2A4A',
        backgroundColor: '#E3ECFB',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        overflow: 'hidden',
    },
    joinHint: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: '#FEF3C7',
        paddingVertical: 8,
        borderRadius: 12,
        marginBottom: 10,
    },
    joinHintText: { color: '#B45309', fontWeight: '700', fontSize: 12 },
    field: { borderRadius: 16, overflow: 'hidden', borderWidth: 3, width: '100%' },
    centerLine: { position: 'absolute', top: '50%', left: '4%', right: '4%', height: 2, marginTop: -1 },
    centerCircle: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 2,
        marginLeft: -40,
        marginTop: -40,
    },
    goalBox: {
        position: 'absolute',
        left: '50%',
        width: 120,
        height: 44,
        borderWidth: 2,
        marginLeft: -60,
    },
    serviceLine: { position: 'absolute', left: '6%', right: '6%', height: 2 },
    halfArc: {
        position: 'absolute',
        left: '50%',
        width: 130,
        height: 65,
        marginLeft: -65,
        borderWidth: 2,
    },
    halfArcTop: {
        top: '7%',
        borderBottomLeftRadius: 65,
        borderBottomRightRadius: 65,
        borderTopWidth: 0,
    },
    halfArcBottom: {
        bottom: '7%',
        borderTopLeftRadius: 65,
        borderTopRightRadius: 65,
        borderBottomWidth: 0,
    },
    keyBox: {
        position: 'absolute',
        left: '50%',
        width: 90,
        height: 52,
        marginLeft: -45,
        borderWidth: 2,
    },
    keyBoxTop: { top: '7%', borderBottomWidth: 0 },
    keyBoxBottom: { bottom: '7%', borderTopWidth: 0 },
    bubble: {
        position: 'absolute',
        width: BUBBLE,
        height: BUBBLE,
        borderRadius: BUBBLE / 2,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: -BUBBLE / 2,
        marginTop: -BUBBLE / 2,
        zIndex: 10,
    },
    bubbleAvatar: { width: BUBBLE - 6, height: BUBBLE - 6, borderRadius: (BUBBLE - 6) / 2 },
    bubbleLabel: {
        position: 'absolute',
        bottom: -16,
        fontSize: 9,
        fontWeight: '800',
        color: '#FFF',
        width: 70,
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowRadius: 2,
    },
    meDot: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 16,
        height: 16,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#FFF',
    },
    fieldLoading: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.2)',
        zIndex: 20,
    },
});
