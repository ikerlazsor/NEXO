import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Dimensions,
    InteractionManager,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { ProfileAvatar } from './ProfileAvatar';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import { hapticError, hapticLight, hapticSuccess } from '../lib/haptics';
import {
    claimFootballSlot,
    clearFootballConfig,
    defaultPadelConfig,
    fetchFootballConfig,
    fetchFootballSlots,
    isPadelConfig,
    releaseFootballSlot,
    saveFootballConfig,
    slotPositions,
    type FootballConfig,
    type FootballOccupant,
} from '../lib/footballLineup';
import { supabase } from '../lib/supabase';

type Person = {
    id: string;
    nombre: string;
    avatar_url?: string | null;
};

type Props = {
    planId: string;
    maxPeople: number;
    isCreator: boolean;
    canClaim: boolean;
    currentUserId: string | null;
    participants: Person[];
    onOpenProfile: (userId: string) => void;
    viewerIsOrganizer?: boolean;
};

const SLOT_SIZE = 58;
const TEAM_BORDER = ['#F8FAFC', '#0F172A'] as const;
/** Ancho fijo: evita onLayout + setState (puede congelar Yoga). */
const COURT_W = Math.min(Dimensions.get('window').width - 40, 360);
const COURT_H = 400;
const SLOT_WRAP_W = 72;

function shortPersonName(nombre?: string | null): string {
    const raw = (nombre ?? '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] ?? raw;
}

export function PadelLineupSection({
    planId,
    maxPeople,
    isCreator,
    canClaim,
    currentUserId,
    participants,
    onOpenProfile,
    viewerIsOrganizer = false,
}: Props) {
    const { t } = useT();
    const styles = useThemedStyles(createPadelStyles);
    const [config, setConfig] = useState<FootballConfig | null>(null);
    const [slots, setSlots] = useState<FootballOccupant[]>([]);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);

    const peopleById = useMemo(() => {
        const map = new Map(participants.map((p) => [p.id, p]));
        return map;
    }, [participants]);

    const load = useCallback(async () => {
        try {
            const nextConfig = await fetchFootballConfig(planId);
            if (nextConfig && isPadelConfig(nextConfig)) {
                setConfig(nextConfig);
                setSlots(await fetchFootballSlots(planId));
            } else {
                setConfig(null);
                setSlots([]);
            }
        } catch {
            setConfig(null);
            setSlots([]);
        } finally {
            setReady(true);
        }
    }, [planId]);

    useEffect(() => {
        let cancelled = false;
        const task = InteractionManager.runAfterInteractions(() => {
            if (cancelled) return;
            void load();
        });
        const fallback = setTimeout(() => {
            if (cancelled) return;
            void load();
        }, 200);
        return () => {
            cancelled = true;
            task.cancel();
            clearTimeout(fallback);
        };
    }, [load]);

    // Realtime solo con alineación activa (evita suscripción al abrir el plan).
    useEffect(() => {
        if (!config && !isCreator) return;
        const channel = supabase
            .channel(`alineacion-padel:${planId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'alineaciones', filter: `plan_id=eq.${planId}` },
                () => {
                    void load();
                },
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'planes', filter: `id=eq.${planId}` },
                () => {
                    void load();
                },
            )
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [planId, config, isCreator, load]);

    const persistConfig = async (next: FootballConfig) => {
        setBusy(true);
        const { error } = await saveFootballConfig(planId, next);
        setBusy(false);
        if (error) {
            hapticError();
            return false;
        }
        setConfig(next);
        void fetchFootballSlots(planId).then(setSlots);
        return true;
    };

    const onEnableLineup = async () => {
        hapticLight();
        const ok = await persistConfig(defaultPadelConfig());
        if (ok) hapticSuccess();
    };

    const onClearLineup = () => {
        if (!isCreator || busy) return;
        Alert.alert(t('futbol.removeLineupTitle'), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('futbol.removeLineupConfirm'),
                style: 'destructive',
                onPress: async () => {
                    setBusy(true);
                    const { error } = await clearFootballConfig(planId);
                    setBusy(false);
                    if (error) {
                        hapticError();
                        return;
                    }
                    setConfig(null);
                    setSlots([]);
                    hapticSuccess();
                },
            },
        ]);
    };

    const onPressSlot = async (equipo: 0 | 1, posicion: number) => {
        const occupant = slots.find((s) => s.equipo === equipo && s.posicion === posicion);
        if (occupant) {
            hapticLight();
            onOpenProfile(occupant.usuario_id);
            return;
        }
        if (viewerIsOrganizer || !canClaim || !currentUserId || busy) return;
        hapticLight();
        setBusy(true);
        const { error } = await claimFootballSlot(planId, equipo, posicion);
        setBusy(false);
        if (error) {
            hapticError();
            const taken = /unique|duplicate|slot|ocupad|taken/i.test(error);
            Alert.alert(t('feed.error'), taken ? t('futbol.slotTaken') : t('feed.joinError'));
            void fetchFootballSlots(planId).then(setSlots);
            return;
        }
        setSlots((prev) => [
            ...prev.filter((s) => s.usuario_id !== currentUserId),
            { equipo, posicion, usuario_id: currentUserId },
        ]);
    };

    const onLeaveLineup = async () => {
        if (!currentUserId || busy) return;
        hapticLight();
        setBusy(true);
        const { error } = await releaseFootballSlot(planId);
        setBusy(false);
        if (error) return;
        setSlots((prev) => prev.filter((s) => s.usuario_id !== currentUserId));
    };

    const mySlot = currentUserId
        ? slots.find((s) => s.usuario_id === currentUserId)
        : undefined;

    if (maxPeople < 4) return null;
    if (!ready) return null;

    if (!config) {
        if (!isCreator) return null;
        return (
            <View style={[styles.section, styles.sectionCreator]}>
                <TouchableOpacity
                    style={styles.lineupBtn}
                    onPress={() => void onEnableLineup()}
                    activeOpacity={0.88}
                    disabled={busy}
                >
                    <Text style={styles.lineupBtnText}>{t('futbol.lineup')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={[styles.section, isCreator && styles.sectionCreator]}>
            {isCreator ? (
                <View style={styles.headRow}>
                    <Text style={styles.sectionTitle}>{t('futbol.lineup')} · 2v2</Text>
                    <TouchableOpacity onPress={onClearLineup} hitSlop={8} disabled={busy}>
                        <Text style={styles.removeText}>{t('futbol.removeLineup')}</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={styles.headSpacer} />
            )}

            {isCreator ? (
                <View style={styles.teams}>
                    {([0, 1] as const).map((equipo) => (
                        <TeamNameEditor
                            key={equipo}
                            team={config.equipos[equipo]}
                            styles={styles}
                            onChange={(team, commit) => {
                                const equipos = [...config.equipos] as FootballConfig['equipos'];
                                equipos[equipo] = { ...equipos[equipo], nombre: team.nombre };
                                const next = { ...config, equipos };
                                setConfig(next);
                                if (commit) void persistConfig(next);
                            }}
                        />
                    ))}
                </View>
            ) : (
                <View style={styles.teamLegend}>
                    {config.equipos.map((team, index) => (
                        <View key={index} style={styles.legendItem}>
                            <View
                                style={[
                                    styles.legendDot,
                                    { backgroundColor: TEAM_BORDER[index] ?? '#FFF' },
                                    index === 0 && styles.legendDotLight,
                                ]}
                            />
                            <Text style={styles.legendName} numberOfLines={1}>{team.nombre}</Text>
                        </View>
                    ))}
                </View>
            )}

            <PadelCourt
                config={config}
                slots={slots}
                peopleById={peopleById}
                onPressSlot={onPressSlot}
                styles={styles}
            />

            {mySlot ? (
                <TouchableOpacity
                    style={styles.leaveBtn}
                    onPress={() => void onLeaveLineup()}
                    activeOpacity={0.8}
                    disabled={busy}
                >
                    <Text style={styles.leaveBtnText}>{t('futbol.leaveSlot')}</Text>
                </TouchableOpacity>
            ) : null}
            {canClaim ? (
                <Text style={styles.hint}>{t('futbol.tapSlot')}</Text>
            ) : viewerIsOrganizer ? (
                <Text style={styles.hint}>{t('organizer.cannotJoinHint')}</Text>
            ) : currentUserId ? (
                <Text style={styles.hint}>{t('futbol.needJoin')}</Text>
            ) : null}
        </View>
    );
}

function TeamNameEditor({
    team,
    onChange,
    styles,
}: {
    team: { nombre: string; color: string };
    onChange: (team: { nombre: string; color: string }, commit: boolean) => void;
    styles: ReturnType<typeof createPadelStyles>;
}) {
    const inputRef = useRef<TextInput>(null);
    return (
        <View style={styles.teamCard}>
            <View style={styles.teamNameRow}>
                <TextInput
                    ref={inputRef}
                    value={team.nombre}
                    onChangeText={(nombre) => onChange({ ...team, nombre }, false)}
                    onEndEditing={(e) => onChange({ ...team, nombre: e.nativeEvent.text }, true)}
                    style={styles.teamInput}
                    maxLength={18}
                />
                <Pressable onPress={() => inputRef.current?.focus()} hitSlop={10}>
                    <Ionicons name="pencil" size={14} color="#64748B" />
                </Pressable>
            </View>
        </View>
    );
}

function PadelCourt({
    config,
    slots,
    peopleById,
    onPressSlot,
    styles,
}: {
    config: FootballConfig;
    slots: FootballOccupant[];
    peopleById: Map<string, Person>;
    onPressSlot: (equipo: 0 | 1, posicion: number) => void;
    styles: ReturnType<typeof createPadelStyles>;
}) {
    const occ = (equipo: 0 | 1, posicion: number) =>
        slots.find((s) => s.equipo === equipo && s.posicion === posicion);

    return (
        <View collapsable={false} style={[styles.court, { width: COURT_W, height: COURT_H }]}>
            <View style={styles.courtBorder} pointerEvents="none" />
            <View style={[styles.net, { top: COURT_H / 2 - 2 }]} />
            <View style={[styles.netPost, { top: COURT_H / 2 - 10, left: 8 }]} />
            <View style={[styles.netPost, { top: COURT_H / 2 - 10, right: 8 }]} />
            <View style={[styles.serviceLine, { top: COURT_H * 0.28 }]} />
            <View style={[styles.serviceLine, { top: COURT_H * 0.72 }]} />
            <View
                style={[
                    styles.centerService,
                    {
                        left: COURT_W / 2 - 1,
                        top: COURT_H * 0.28,
                        height: COURT_H * 0.44,
                    },
                ]}
            />

            {([0, 1] as const).map((equipo) =>
                slotPositions(config, equipo).map((slot, posicion) => {
                    const taken = occ(equipo, posicion);
                    const person = taken ? peopleById.get(taken.usuario_id) : null;
                    const border = TEAM_BORDER[equipo];
                    const label = taken ? shortPersonName(person?.nombre) : '';
                    return (
                        <View
                            key={`${equipo}-${posicion}`}
                            style={[
                                styles.slotWrap,
                                {
                                    left: slot.x * COURT_W - SLOT_WRAP_W / 2,
                                    top: slot.y * COURT_H - SLOT_SIZE / 2,
                                },
                            ]}
                        >
                            <TouchableOpacity
                                activeOpacity={0.85}
                                onPress={() => onPressSlot(equipo, posicion)}
                                style={[
                                    styles.slot,
                                    {
                                        borderColor: border,
                                        backgroundColor:
                                            equipo === 0
                                                ? 'rgba(255,255,255,0.92)'
                                                : 'rgba(15,23,42,0.35)',
                                    },
                                    taken && styles.slotFilled,
                                ]}
                            >
                                {taken ? (
                                    <ProfileAvatar
                                        uri={person?.avatar_url}
                                        name={person?.nombre ?? '?'}
                                        size={SLOT_SIZE - 4}
                                        recyclingKey={taken.usuario_id}
                                    />
                                ) : (
                                    <View
                                        style={[
                                            styles.emptyDot,
                                            {
                                                backgroundColor:
                                                    equipo === 0 ? '#CBD5E1' : '#F8FAFC',
                                            },
                                        ]}
                                    />
                                )}
                            </TouchableOpacity>
                            {label ? (
                                <Text style={styles.slotName} numberOfLines={1}>
                                    {label}
                                </Text>
                            ) : (
                                <View style={styles.slotNameSpacer} />
                            )}
                        </View>
                    );
                }),
            )}
        </View>
    );
}

function createPadelStyles(c: ThemeColors) {
    return StyleSheet.create({
        section: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 18 },
        sectionCreator: { paddingTop: 22 },
        sectionTitle: { fontSize: 16, fontWeight: '800', color: c.text },
        headRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            paddingHorizontal: 10,
        },
        removeText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
        headSpacer: { height: 16 },
        lineupBtn: {
            marginTop: 8,
            marginHorizontal: 10,
            backgroundColor: '#2563EB',
            borderRadius: 16,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
        },
        lineupBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
        teams: { flexDirection: 'row', gap: 8, marginBottom: 10, paddingHorizontal: 10 },
        teamCard: {
            flex: 1,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 12,
            padding: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
        },
        teamNameRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        teamInput: {
            flex: 1,
            fontSize: 13,
            fontWeight: '800',
            color: c.text,
            paddingVertical: 2,
        },
        teamLegend: {
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 28,
            marginBottom: 10,
        },
        legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
        legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
        legendDotLight: { borderColor: c.borderStrong },
        legendName: { fontSize: 13, fontWeight: '700', color: c.textMuted },
        court: {
            alignSelf: 'center',
            borderRadius: 20,
            backgroundColor: '#1D4ED8',
            overflow: 'visible',
            borderWidth: 3,
            borderColor: 'rgba(255,255,255,0.85)',
            marginBottom: 6,
        },
        courtBorder: {
            position: 'absolute',
            top: 10,
            left: 10,
            right: 10,
            bottom: 10,
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.9)',
            borderRadius: 4,
        },
        net: {
            position: 'absolute',
            left: 10,
            right: 10,
            height: 4,
            backgroundColor: 'rgba(248,250,252,0.95)',
        },
        netPost: {
            position: 'absolute',
            width: 6,
            height: 20,
            borderRadius: 2,
            backgroundColor: '#0F172A',
        },
        serviceLine: {
            position: 'absolute',
            left: 10,
            right: 10,
            height: 2,
            backgroundColor: 'rgba(255,255,255,0.75)',
        },
        centerService: {
            position: 'absolute',
            width: 2,
            backgroundColor: 'rgba(255,255,255,0.75)',
        },
        slotWrap: {
            position: 'absolute',
            width: SLOT_WRAP_W,
            alignItems: 'center',
        },
        slot: {
            width: SLOT_SIZE,
            height: SLOT_SIZE,
            borderRadius: SLOT_SIZE / 2,
            borderWidth: 2.5,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
        },
        slotFilled: {
            backgroundColor: 'transparent',
        },
        slotName: {
            marginTop: -2,
            maxWidth: SLOT_WRAP_W,
            fontSize: 11,
            lineHeight: 13,
            fontWeight: '800',
            color: '#FFF',
            textAlign: 'center',
            textShadowColor: 'rgba(0,0,0,0.85)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 3,
        },
        slotNameSpacer: { height: 11 },
        emptyDot: { width: 16, height: 16, borderRadius: 8, opacity: 0.95 },
        leaveBtn: {
            marginTop: 12,
            alignSelf: 'center',
            paddingHorizontal: 14,
            paddingVertical: 8,
        },
        leaveBtnText: { fontSize: 13, fontWeight: '700', color: c.danger },
        hint: {
            marginTop: 10,
            textAlign: 'center',
            fontSize: 12,
            fontWeight: '600',
            color: c.textMuted,
            paddingHorizontal: 10,
        },
    });
}
