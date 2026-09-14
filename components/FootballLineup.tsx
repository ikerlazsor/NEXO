import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { hapticError, hapticLight, hapticSelection, hapticSuccess } from '../lib/haptics';
import {
    TEAM_COLORS,
    claimFootballSlot,
    clearFootballConfig,
    configWithUiFormat,
    fetchFootballConfig,
    fetchFootballSlots,
    formatsForMaxPeople,
    isFutsalConfig,
    releaseFootballSlot,
    saveFootballConfig,
    slotPositions,
    uiFormatFromConfig,
    type FootballConfig,
    type FootballFormat,
    type FootballOccupant,
} from '../lib/footballLineup';
import { supabase } from '../lib/supabase';

function formatLabel(formato: FootballFormat, t: (key: string) => string): string {
    return formato === 'sala' ? t('futbol.formatSala') : formato;
}

function shortPersonName(nombre?: string | null): string {
    const raw = (nombre ?? '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] ?? raw;
}

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
const CIRCLE = 118;
const BALL = 18;
const SLOT_WRAP_W = 72;


function isLightColor(color: string) {
    const c = color.trim().toUpperCase();
    return c === '#FFF' || c === '#FFFFFF';
}

export function FootballLineupSection({
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
    const styles = useThemedStyles(createFootballStyles);
    const options = useMemo(() => formatsForMaxPeople(maxPeople), [maxPeople]);
    const [config, setConfig] = useState<FootballConfig | null>(null);
    const [slots, setSlots] = useState<FootballOccupant[]>([]);
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);

    const peopleById = useMemo(() => {
        const map = new Map(participants.map((p) => [p.id, p]));
        return map;
    }, [participants]);

    const load = useCallback(async () => {
        try {
            const nextConfig = await fetchFootballConfig(planId);
            setConfig(nextConfig);
            if (nextConfig) {
                const nextSlots = await fetchFootballSlots(planId);
                setSlots(nextSlots);
            } else {
                setSlots([]);
            }
        } catch {
            setConfig(null);
            setSlots([]);
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

    useEffect(() => {
        const channel = supabase
            .channel(`alineacion:${planId}`)
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
    }, [planId, load]);

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
                    setPicking(false);
                    hapticSuccess();
                },
            },
        ]);
    };

    const onPickFormat = async (formato: FootballFormat) => {
        hapticSelection();
        const next = configWithUiFormat(formato, config);
        setPicking(false);
        const ok = await persistConfig(next);
        if (ok) hapticSuccess();
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

    if (!options.length) return null;

    if (!config) {
        if (!isCreator) return null;
        return (
            <View style={[styles.section, isCreator && styles.sectionCreator]}>
                {picking ? (
                    <View style={styles.formatWrap}>
                        {options.map((formato) => (
                            <TouchableOpacity
                                key={formato}
                                style={styles.formatChip}
                                onPress={() => void onPickFormat(formato)}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.formatChipText}>{formatLabel(formato, t)}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.lineupBtn}
                        onPress={() => setPicking(true)}
                        activeOpacity={0.88}
                    >
                        <Text style={styles.lineupBtnText}>{t('futbol.lineup')}</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    }

    return (
        <View style={[styles.section, isCreator && styles.sectionCreator]}>
            {isCreator ? (
                <View style={styles.headRow}>
                    <View style={styles.headTitleWrap}>
                        <Text style={styles.sectionTitle} numberOfLines={2}>
                            {t('futbol.lineup')}
                        </Text>
                        <Text style={styles.headFormat} numberOfLines={1}>
                            {formatLabel(uiFormatFromConfig(config), t)}
                        </Text>
                    </View>
                    <View style={styles.headActions}>
                        <TouchableOpacity onPress={() => setPicking((v) => !v)} hitSlop={8}>
                            <Text style={styles.changeText}>{t('futbol.pickFormat')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onClearLineup} hitSlop={8} disabled={busy}>
                            <Text style={styles.removeText}>{t('futbol.removeLineup')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <View style={styles.headSpacer} />
            )}
            {picking && isCreator ? (
                <View style={styles.formatWrap}>
                    {options.map((formato) => {
                        const active = uiFormatFromConfig(config) === formato;
                        return (
                        <TouchableOpacity
                            key={formato}
                            style={[styles.formatChip, active && styles.formatChipOn]}
                            onPress={() => void onPickFormat(formato)}
                            activeOpacity={0.85}
                        >
                            <Text style={[styles.formatChipText, active && styles.formatChipTextOn]}>
                                {formatLabel(formato, t)}
                            </Text>
                        </TouchableOpacity>
                        );
                    })}
                </View>
            ) : null}

            {isCreator ? (
                <View style={styles.teams}>
                    {([0, 1] as const).map((equipo) => (
                        <TeamEditor
                            key={equipo}
                            team={config.equipos[equipo]}
                            styles={styles}
                            onChange={(team, commit) => {
                                const equipos = [...config.equipos] as FootballConfig['equipos'];
                                equipos[equipo] = team;
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
                                    { backgroundColor: team.color },
                                    isLightColor(team.color) && styles.legendDotLight,
                                ]}
                            />
                            <Text style={styles.legendName} numberOfLines={1}>{team.nombre}</Text>
                        </View>
                    ))}
                </View>
            )}

            <Pitch
                config={config}
                slots={slots}
                peopleById={peopleById}
                onPressSlot={onPressSlot}
                styles={styles}
                futsal={isFutsalConfig(config)}
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

function TeamEditor({
    team,
    onChange,
    styles,
}: {
    team: { nombre: string; color: string };
    onChange: (team: { nombre: string; color: string }, commit: boolean) => void;
    styles: ReturnType<typeof createFootballStyles>;
}) {
    const inputRef = useRef<TextInput>(null);

    return (
        <View style={styles.teamCard}>
            <View style={[styles.teamBar, { backgroundColor: team.color }]} />
            <View style={styles.teamNameRow}>
                <TextInput
                    ref={inputRef}
                    value={team.nombre}
                    onChangeText={(nombre) => onChange({ ...team, nombre }, false)}
                    onEndEditing={(e) => onChange({ ...team, nombre: e.nativeEvent.text }, true)}
                    style={styles.teamInput}
                    maxLength={18}
                />
                <Pressable
                    onPress={() => inputRef.current?.focus()}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Editar nombre"
                >
                    <Ionicons name="pencil" size={14} color="#64748B" />
                </Pressable>
            </View>
            <View style={styles.colorRow}>
                {TEAM_COLORS.map((color) => (
                    <Pressable
                        key={color}
                        onPress={() => onChange({ ...team, color }, true)}
                        style={[
                            styles.colorDot,
                            { backgroundColor: color },
                            isLightColor(color) && styles.colorDotLight,
                            team.color === color && styles.colorDotOn,
                        ]}
                    />
                ))}
            </View>
        </View>
    );
}

function Pitch({
    config,
    slots,
    peopleById,
    onPressSlot,
    styles,
    futsal,
}: {
    config: FootballConfig;
    slots: FootballOccupant[];
    peopleById: Map<string, Person>;
    onPressSlot: (equipo: 0 | 1, posicion: number) => void;
    styles: ReturnType<typeof createFootballStyles>;
    futsal: boolean;
}) {
    const [size, setSize] = useState({ w: 0, h: 0 });
    const occ = (equipo: 0 | 1, posicion: number) =>
        slots.find((s) => s.equipo === equipo && s.posicion === posicion);
    const line = futsal ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.75)';
    const circleSize = futsal ? 72 : CIRCLE;

    return (
        <View
            collapsable={false}
            style={[styles.pitch, futsal && styles.pitchFutsal]}
            onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                const h = Math.round(e.nativeEvent.layout.height);
                if (w > 0 && h > 0 && (w !== size.w || h !== size.h)) {
                    setSize({ w, h });
                }
            }}
        >
            {!futsal && size.h > 0
                ? Array.from({ length: 8 }, (_, i) => (
                      <View
                          key={i}
                          pointerEvents="none"
                          style={[
                              styles.turfStripe,
                              {
                                  top: (size.h * i) / 8,
                                  height: size.h / 8,
                                  backgroundColor: i % 2 === 0 ? '#166534' : '#15803D',
                              },
                          ]}
                      />
                  ))
                : null}

            {futsal && size.h > 0
                ? Array.from({ length: 6 }, (_, i) => (
                      <View
                          key={`wood-${i}`}
                          pointerEvents="none"
                          style={[
                              styles.turfStripe,
                              {
                                  top: (size.h * i) / 6,
                                  height: size.h / 6,
                                  backgroundColor: i % 2 === 0 ? '#C2410C' : '#EA580C',
                              },
                          ]}
                      />
                  ))
                : null}

            {size.w > 0 ? (
                <>
                    <View
                        style={[styles.pitchBorder, futsal && { borderColor: line }]}
                        pointerEvents="none"
                    />
                    <View style={[styles.halfway, { top: size.h / 2 - 1, backgroundColor: line }]} />
                    <View
                        style={[
                            styles.centerCircle,
                            {
                                width: circleSize,
                                height: circleSize,
                                borderRadius: circleSize / 2,
                                left: size.w / 2 - circleSize / 2,
                                top: size.h / 2 - circleSize / 2,
                                borderColor: line,
                            },
                        ]}
                    />
                    <View
                        pointerEvents="none"
                        style={[
                            styles.centerBall,
                            { left: size.w / 2 - BALL / 2, top: size.h / 2 - BALL / 2 },
                        ]}
                    >
                        <Ionicons name="football" size={BALL} color="#FFF" />
                    </View>

                    {futsal ? (
                        <>
                            {/* Áreas de penalti (semicírculos de fútbol sala) */}
                            <View
                                style={[
                                    styles.futsalArc,
                                    styles.futsalArcTop,
                                    {
                                        left: size.w / 2 - size.w * 0.28,
                                        width: size.w * 0.56,
                                        height: size.w * 0.28,
                                        borderColor: line,
                                    },
                                ]}
                            />
                            <View
                                style={[
                                    styles.futsalArc,
                                    styles.futsalArcBottom,
                                    {
                                        left: size.w / 2 - size.w * 0.28,
                                        width: size.w * 0.56,
                                        height: size.w * 0.28,
                                        borderColor: line,
                                    },
                                ]}
                            />
                            {/* Porterías pequeñas */}
                            <View
                                style={[
                                    styles.futsalGoal,
                                    styles.futsalGoalTop,
                                    {
                                        left: size.w / 2 - size.w * 0.12,
                                        width: size.w * 0.24,
                                        borderColor: line,
                                    },
                                ]}
                            />
                            <View
                                style={[
                                    styles.futsalGoal,
                                    styles.futsalGoalBottom,
                                    {
                                        left: size.w / 2 - size.w * 0.12,
                                        width: size.w * 0.24,
                                        borderColor: line,
                                    },
                                ]}
                            />
                            {/* Esquinas */}
                            <View style={[styles.futsalCorner, styles.futsalCornerTL, { borderColor: line }]} />
                            <View style={[styles.futsalCorner, styles.futsalCornerTR, { borderColor: line }]} />
                            <View style={[styles.futsalCorner, styles.futsalCornerBL, { borderColor: line }]} />
                            <View style={[styles.futsalCorner, styles.futsalCornerBR, { borderColor: line }]} />
                        </>
                    ) : (
                        <>
                            <View
                                style={[
                                    styles.box,
                                    styles.boxTop,
                                    { left: size.w * 0.22, width: size.w * 0.56 },
                                ]}
                            />
                            <View
                                style={[
                                    styles.box,
                                    styles.boxBottom,
                                    { left: size.w * 0.22, width: size.w * 0.56 },
                                ]}
                            />
                        </>
                    )}

                    {([0, 1] as const).map((equipo) =>
                        slotPositions(config, equipo).map((slot, posicion) => {
                            const taken = occ(equipo, posicion);
                            const person = taken ? peopleById.get(taken.usuario_id) : null;
                            const color = config.equipos[equipo].color;
                            const label = taken ? shortPersonName(person?.nombre) : '';
                            return (
                                <View
                                    key={`${equipo}-${posicion}`}
                                    style={[
                                        styles.slotWrap,
                                        {
                                            left: slot.x * size.w - SLOT_WRAP_W / 2,
                                            top: slot.y * size.h - SLOT_SIZE / 2,
                                        },
                                    ]}
                                >
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        onPress={() => onPressSlot(equipo, posicion)}
                                        style={[
                                            styles.slot,
                                            taken
                                                ? [styles.slotFilled, { borderColor: color }]
                                                : {
                                                    borderColor: isLightColor(color) ? '#E2E8F0' : color,
                                                    backgroundColor: isLightColor(color)
                                                        ? 'rgba(255,255,255,0.9)'
                                                        : `${color}40`,
                                                },
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
                                            <View style={[styles.emptyDot, { backgroundColor: color }]} />
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
                </>
            ) : null}
        </View>
    );
}

function createFootballStyles(c: ThemeColors) {
    return StyleSheet.create({
    section: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 18 },
    sectionCreator: { paddingTop: 22 },
    sectionTitle: { fontSize: 16, fontWeight: '800', color: c.text },
    headRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 10,
        paddingHorizontal: 10,
        gap: 10,
    },
    headTitleWrap: { flex: 1, minWidth: 0, paddingRight: 4 },
    headFormat: {
        marginTop: 2,
        fontSize: 13,
        fontWeight: '700',
        color: c.textMuted,
    },
    headActions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0, paddingTop: 2 },
    changeText: { fontSize: 13, fontWeight: '700', color: '#16A34A' },
    removeText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
    headSpacer: { height: 32 },
    lineupBtn: {
        marginTop: 8,
        marginHorizontal: 10,
        backgroundColor: '#16A34A',
        borderRadius: 16,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lineupBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
    formatWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
        marginBottom: 8,
        paddingHorizontal: 10,
    },
    formatChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: c.surfaceSubtle,
        borderWidth: 1,
        borderColor: c.border,
    },
    formatChipOn: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
    formatChipText: { fontSize: 14, fontWeight: '800', color: c.text },
    formatChipTextOn: { color: '#FFF' },
    teams: { flexDirection: 'row', gap: 8, marginBottom: 10, paddingHorizontal: 10 },
    teamCard: {
        flex: 1,
        backgroundColor: c.surfaceSubtle,
        borderRadius: 12,
        padding: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    teamBar: { height: 3, borderRadius: 2, marginBottom: 6 },
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
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
    colorDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'transparent' },
    colorDotLight: { borderColor: c.borderStrong },
    colorDotOn: { borderColor: c.text },
    teamLegend: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 28,
        marginBottom: 10,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '42%' },
    legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
    legendDotLight: { borderColor: c.borderStrong, backgroundColor: c.surface },
    legendName: { fontSize: 13, fontWeight: '700', color: c.textMuted },
    pitch: {
        height: 640,
        borderRadius: 20,
        backgroundColor: '#15803D',
        overflow: 'visible',
        borderWidth: 3,
        borderColor: 'rgba(255,255,255,0.7)',
        marginBottom: 6,
    },
    pitchFutsal: {
        backgroundColor: '#EA580C',
        borderColor: 'rgba(255,255,255,0.85)',
    },
    turfStripe: {
        position: 'absolute',
        left: 0,
        right: 0,
    },
    pitchBorder: {
        position: 'absolute',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.65)',
        top: 4,
        left: 4,
        right: 4,
        bottom: 4,
        borderRadius: 2,
    },
    halfway: {
        position: 'absolute',
        left: 4,
        right: 4,
        height: 2,
        backgroundColor: 'rgba(255,255,255,0.75)',
    },
    centerCircle: {
        position: 'absolute',
        width: CIRCLE,
        height: CIRCLE,
        borderRadius: CIRCLE / 2,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.75)',
    },
    centerBall: {
        position: 'absolute',
        width: BALL,
        height: BALL,
        alignItems: 'center',
        justifyContent: 'center',
    },
    box: {
        position: 'absolute',
        height: 84,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.7)',
    },
    boxTop: { top: 4, borderTopWidth: 0 },
    boxBottom: { bottom: 4, borderBottomWidth: 0 },
    futsalArc: {
        position: 'absolute',
        borderWidth: 2,
        backgroundColor: 'transparent',
    },
    futsalArcTop: {
        top: 4,
        borderBottomLeftRadius: 999,
        borderBottomRightRadius: 999,
        borderTopWidth: 0,
    },
    futsalArcBottom: {
        bottom: 4,
        borderTopLeftRadius: 999,
        borderTopRightRadius: 999,
        borderBottomWidth: 0,
    },
    futsalGoal: {
        position: 'absolute',
        height: 18,
        borderWidth: 2,
        backgroundColor: 'rgba(15,23,42,0.25)',
    },
    futsalGoalTop: { top: 4, borderTopWidth: 0 },
    futsalGoalBottom: { bottom: 4, borderBottomWidth: 0 },
    futsalCorner: {
        position: 'absolute',
        width: 18,
        height: 18,
        borderWidth: 2,
    },
    futsalCornerTL: {
        top: 4,
        left: 4,
        borderRightWidth: 0,
        borderBottomWidth: 0,
        borderBottomRightRadius: 18,
    },
    futsalCornerTR: {
        top: 4,
        right: 4,
        borderLeftWidth: 0,
        borderBottomWidth: 0,
        borderBottomLeftRadius: 18,
    },
    futsalCornerBL: {
        bottom: 4,
        left: 4,
        borderRightWidth: 0,
        borderTopWidth: 0,
        borderTopRightRadius: 18,
    },
    futsalCornerBR: {
        bottom: 4,
        right: 4,
        borderLeftWidth: 0,
        borderTopWidth: 0,
        borderTopLeftRadius: 18,
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
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
    },
    slotFilled: {
        borderWidth: 2.5,
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
