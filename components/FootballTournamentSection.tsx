import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
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
    aficionTeamIndex,
    claimTournamentSlot,
    DEFAULT_TOURNAMENT_AFICION,
    DEFAULT_TOURNAMENT_ULTRAS,
    fansCapacity,
    fansFilledCount,
    firstFreeFansSlot,
    firstFreeSlot,
    isFansTeam,
    kickTournamentSlot,
    saveTournamentConfig,
    fullestTeamIndex,
    startersCount,
    teamRegistrationStats,
    teamStarterSlots,
    ultrasTeamIndex,
    updateStanding,
    type LeagueStanding,
    type TournamentConfig,
    type TournamentOccupant,
} from '../lib/footballTournament';
import { releaseFootballSlot, TEAM_COLORS } from '../lib/footballLineup';
import { planShareUrl } from '../lib/shareLinks';
import {
    cacheRemoteImageForShare,
    setTournamentShareHandler,
    shareTournamentPitchImage,
    waitForShareAvatars,
} from '../lib/shareTournamentPitch';
import { getPublicProfileCards, peekPublicProfileCards } from '../lib/profileData';
import {
    loadTournamentLineup,
    peekTournamentLineup,
    seedTournamentLineup,
    subscribeTournamentLineup,
} from '../lib/tournamentLineupCache';
import { teamVibeFor } from '../lib/tournamentTeamVibes';
import { presentInAppToast } from '../lib/inAppToast';
import { TournamentChampionPoll } from './TournamentChampionPoll';
import { supabase } from '../lib/supabase';

function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
}

type Person = {
    id: string;
    nombre: string;
    avatar_url?: string | null;
};

type Props = {
    planId: string;
    isCreator: boolean;
    canClaim: boolean;
    /** Abrir modal de elegir clase (puede unirse aunque aún no sea miembro). */
    canPickTeam?: boolean;
    /** Garantiza membresía aceptada antes de reclamar hueco (WhatsApp → elegir clase). */
    ensureJoined?: () => Promise<boolean>;
    currentUserId: string | null;
    participants: Person[];
    onOpenProfile: (userId: string) => void;
    viewerIsOrganizer?: boolean;
    preferredTeam?: number | null;
    /** Perfil del viewer para pintar burbuja al instante al reclamar. */
    viewerPerson?: Person | null;
    /** El host temprano (link WhatsApp) ya muestra el picker. */
    skipAutoPick?: boolean;
    /** Guest → AuthPrompt (poll / huecos / elegir clase). */
    requireAccount?: () => boolean;
};

const AVATAR = 64;
const SLOT_H = 92;

function isLightColor(color: string) {
    const c = color.trim().toUpperCase();
    return c === '#FFF' || c === '#FFFFFF';
}

function shortName(nombre?: string | null) {
    const raw = (nombre ?? '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] ?? raw;
}

function borderForTeam(color: string) {
    return isLightColor(color) ? '#E2E8F0' : color;
}

export function FootballTournamentSection({
    planId,
    isCreator,
    canClaim,
    canPickTeam,
    ensureJoined,
    currentUserId,
    participants,
    onOpenProfile,
    viewerIsOrganizer = false,
    preferredTeam = null,
    viewerPerson = null,
    skipAutoPick = false,
    requireAccount,
}: Props) {
    const allowPick = canPickTeam ?? canClaim;
    const { t } = useT();
    const styles = useThemedStyles(createStyles);
    const cached = peekTournamentLineup(planId);
    const [config, setConfig] = useState<TournamentConfig | null>(() => cached?.config ?? null);
    const [slots, setSlots] = useState<TournamentOccupant[]>(() => cached?.slots ?? []);
    const [teamIndex, setTeamIndex] = useState(() => {
        const mine = currentUserId
            ? cached?.slots.find((s) => String(s.usuario_id) === String(currentUserId))
            : undefined;
        if (mine && cached?.config && !isFansTeam(cached.config, mine.equipo)) {
            return mine.equipo;
        }
        if (
            preferredTeam != null &&
            preferredTeam >= 0 &&
            cached?.config &&
            preferredTeam < cached.config.equipos.length
        ) {
            return preferredTeam;
        }
        return 0;
    });
    const [tab, setTab] = useState<'squads' | 'league'>('squads');
    const [busy, setBusy] = useState(false);
    const [autoJoinedTeam, setAutoJoinedTeam] = useState(false);
    const [pickOpen, setPickOpen] = useState(false);
    /** Letterbox solo al capturar (campo visible = avatares ya cargados). */
    const [shareFrame, setShareFrame] = useState(false);
    /** file:// locales para view-shot (expo-image / remoto sale gris). */
    const [shareAvatarLocals, setShareAvatarLocals] = useState<Map<string, string> | null>(null);
    const pitchShareRef = useRef<View>(null);
    const claimInFlight = useRef(false);
    /** Evita que el realtime pise un claim optimista recién hecho. */
    const suppressReloadUntil = useRef(0);
    /** Fichas de huecos (no esperar al detalle del plan). */
    const [slotPeople, setSlotPeople] = useState<Person[]>([]);

    const peopleById = useMemo(() => {
        const map = new Map(participants.map((p) => [String(p.id), p]));
        for (const p of slotPeople) {
            if (!map.has(String(p.id))) map.set(String(p.id), p);
        }
        if (viewerPerson?.id) map.set(String(viewerPerson.id), viewerPerson);
        return map;
    }, [participants, slotPeople, viewerPerson]);

    const load = useCallback(async (force = false) => {
        try {
            const snap = await loadTournamentLineup(planId, { force });
            const live = peekTournamentLineup(planId);
            const keep =
                live?.protectUntil && Date.now() < live.protectUntil ? live : snap;
            const next = keep.config;
            const nextSlots = keep.slots;
            // Conserva capitanes optimistas si el server aún no los ha persistido.
            setConfig((prev) => {
                if (!next) return null;
                if (!prev) return next;
                return {
                    ...next,
                    equipos: next.equipos.map((e, i) => {
                        if (e.capitan_id) return e;
                        const prevCap = prev.equipos[i]?.capitan_id;
                        return prevCap ? { ...e, capitan_id: prevCap } : e;
                    }),
                };
            });
            setSlots(nextSlots);
            if (next) {
                setTeamIndex((i) => Math.min(i, Math.max(0, next.equipos.length - 1)));
            }
        } catch {
            setConfig(null);
            setSlots([]);
        }
    }, [planId]);

    // Solo al cambiar de plan: reset + paint warm. No cerrar el picker cuando llega currentUserId.
    useEffect(() => {
        setPickOpen(false);
        setAutoJoinedTeam(false);
        const warm = peekTournamentLineup(planId);
        if (warm?.config) {
            setConfig(warm.config);
            setSlots(warm.slots);
        }
        void load();
    }, [load, planId]);

    useEffect(() => {
        return subscribeTournamentLineup(planId, (snap) => {
            if (!snap.config) return;
            setConfig(snap.config);
            setSlots(snap.slots);
            if (snap.protectUntil && Date.now() < snap.protectUntil) {
                setPickOpen(false);
                setAutoJoinedTeam(true);
            }
        });
    }, [planId]);

    useEffect(() => {
        const ids = [...new Set(slots.map((s) => String(s.usuario_id)).filter(Boolean))];
        if (!ids.length) {
            setSlotPeople([]);
            return;
        }
        const peek = peekPublicProfileCards(ids);
        if (peek.length) {
            setSlotPeople(
                peek.map((p) => ({
                    id: p.id,
                    nombre: p.nombre ?? '',
                    avatar_url: p.avatar_url,
                })),
            );
        }
        let cancelled = false;
        void getPublicProfileCards(ids)
            .then((rows) => {
                if (cancelled) return;
                setSlotPeople(
                    rows.map((p) => ({
                        id: p.id,
                        nombre: p.nombre ?? '',
                        avatar_url: p.avatar_url,
                    })),
                );
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [slots]);

    useEffect(() => {
        if (!currentUserId || !config) return;
        const mine = slots.find((s) => String(s.usuario_id) === String(currentUserId));
        if (mine && !isFansTeam(config, mine.equipo)) {
            setTeamIndex(mine.equipo);
        }
    }, [config, currentUserId, slots]);

    useEffect(() => {
        // Un claim = delete+insert (+ a veces update capitán). Agrupar en 1 reload suave.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const scheduleReload = () => {
            if (claimInFlight.current || Date.now() < suppressReloadUntil.current) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                if (claimInFlight.current || Date.now() < suppressReloadUntil.current) return;
                void load(true);
            }, 280);
        };
        const channel = supabase
            .channel(`torneo:${planId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'alineaciones', filter: `plan_id=eq.${planId}` },
                scheduleReload,
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'planes', filter: `id=eq.${planId}` },
                scheduleReload,
            )
            .subscribe();
        return () => {
            if (timer) clearTimeout(timer);
            void supabase.removeChannel(channel);
        };
    }, [planId, load]);

    const applyOptimisticCaptain = useCallback(
        (equipo: number) => {
            if (!currentUserId) return;
            setConfig((prev) => {
                if (!prev || isFansTeam(prev, equipo)) return prev;
                if (prev.equipos[equipo]?.capitan_id) return prev;
                return {
                    ...prev,
                    equipos: prev.equipos.map((e, i) =>
                        i === equipo ? { ...e, capitan_id: currentUserId } : e,
                    ),
                };
            });
        },
        [currentUserId],
    );

    const applyOptimisticClaim = useCallback(
        (equipo: number, posicion: number) => {
            if (!currentUserId || !config) return;
            if (!isFansTeam(config, equipo)) {
                setTeamIndex(equipo);
                if (!config.equipos[equipo]?.capitan_id) {
                    applyOptimisticCaptain(equipo);
                }
            }
            setSlots((prev) => {
                const next = [
                    ...prev.filter((s) => String(s.usuario_id) !== String(currentUserId)),
                    { equipo, posicion, usuario_id: currentUserId },
                ];
                seedTournamentLineup(planId, config, next);
                return next;
            });
            setAutoJoinedTeam(true);
            setPickOpen(false);
        },
        [applyOptimisticCaptain, config, currentUserId, planId],
    );

    const claimIntoTeam = useCallback(
        (equipo: number) => {
            if (!config) return;
            // Cerrar modal ANTES de Auth/Alert (evita crash iOS con 2 Modales).
            setPickOpen(false);
            if (requireAccount?.()) return;
            if (!currentUserId) return;
            if (claimInFlight.current) {
                hapticLight();
                return;
            }
            // Afición / ultras (legacy link): los primeros van a ultras automáticamente.
            const fansTarget =
                isFansTeam(config, equipo) ? firstFreeFansSlot(config, slots) : null;
            const target = fansTarget
                ? fansTarget
                : (() => {
                      const pos = firstFreeSlot(config, slots, equipo);
                      return pos == null ? null : { equipo, posicion: pos };
                  })();
            if (target == null) {
                hapticError();
                void sleep(80).then(() =>
                    Alert.alert(t('feed.error'), t('torneo.teamFull')),
                );
                return;
            }
            const snapshot = slots;
            const configSnapshot = config;
            const teamName =
                isFansTeam(config, target.equipo)
                    ? t('torneo.fans')
                    : (config.equipos[target.equipo]?.nombre ?? t('torneo.tabSquads'));
            claimInFlight.current = true;
            // UI al instante; join+claim en segundo plano (sin dejar el toque “muerto”).
            applyOptimisticClaim(target.equipo, target.posicion);
            hapticSuccess();
            presentInAppToast({
                id: `torneo-join:${planId}`,
                title: t('torneo.joinedToast', { team: teamName }),
                body: t('torneo.joinedToastBody'),
            });
            suppressReloadUntil.current = Date.now() + 1200;
            void (async () => {
                try {
                    if (ensureJoined) {
                        const ok = await ensureJoined();
                        if (!ok) {
                            // ensureJoined ya muestra Alert; no reabrir picker.
                            setSlots(snapshot);
                            setConfig(configSnapshot);
                            seedTournamentLineup(planId, configSnapshot, snapshot);
                            setAutoJoinedTeam(false);
                            return;
                        }
                    }
                    const { error } = await claimTournamentSlot(
                        planId,
                        target.equipo,
                        target.posicion,
                    );
                    if (error) {
                        setSlots(snapshot);
                        setConfig(configSnapshot);
                        seedTournamentLineup(planId, configSnapshot, snapshot);
                        setAutoJoinedTeam(false);
                        hapticError();
                        await sleep(80);
                        Alert.alert(
                            t('feed.error'),
                            /unique|duplicate|slot|ocupad|taken/i.test(error)
                                ? t('futbol.slotTaken')
                                : t('feed.joinError'),
                        );
                        void load(true);
                    }
                } finally {
                    claimInFlight.current = false;
                }
            })();
        },
        [
            applyOptimisticClaim,
            config,
            currentUserId,
            ensureJoined,
            load,
            planId,
            requireAccount,
            slots,
            t,
        ],
    );

    useEffect(() => {
        if (!config || !allowPick || !currentUserId) return;
        const already = slots.find((s) => String(s.usuario_id) === String(currentUserId));
        if (already) {
            if (!isFansTeam(config, already.equipo)) setTeamIndex(already.equipo);
            setAutoJoinedTeam(true);
            setPickOpen(false);
            return;
        }
        // El early-pick del link ya gestiona el modal.
        if (skipAutoPick) {
            setAutoJoinedTeam(true);
            return;
        }
        // Cualquier link (con o sin ?team=): siempre elegir; no auto-claim.
        if (!autoJoinedTeam) {
            setAutoJoinedTeam(true);
            if (
                preferredTeam != null &&
                preferredTeam >= 0 &&
                preferredTeam < config.equipos.length
            ) {
                setTeamIndex(preferredTeam);
            }
            setPickOpen(true);
        }
    }, [allowPick, autoJoinedTeam, config, currentUserId, preferredTeam, skipAutoPick, slots]);

    const allTeamStats = useMemo(
        () => (config ? teamRegistrationStats(config, slots) : []),
        [config, slots],
    );
    const teamStats = useMemo(
        () => allTeamStats.filter((s) => !s.aficion && !s.ultras),
        [allTeamStats],
    );
    const aficionStat = useMemo(
        () => allTeamStats.find((s) => s.aficion),
        [allTeamStats],
    );
    const ultrasStat = useMemo(
        () => allTeamStats.find((s) => s.ultras),
        [allTeamStats],
    );

    const persist = async (next: TournamentConfig) => {
        setBusy(true);
        const { error } = await saveTournamentConfig(planId, next);
        setBusy(false);
        if (error) {
            hapticError();
            Alert.alert(t('feed.error'), error);
            return false;
        }
        setConfig(next);
        return true;
    };

    const captureAndShare = useCallback(
        async (message: string) => {
            const teamSlots = slots.filter((s) => s.equipo === teamIndex);
            const localMap = new Map<string, string>();
            await Promise.all(
                teamSlots.map(async (s) => {
                    const id = String(s.usuario_id);
                    const remote = peopleById.get(id)?.avatar_url;
                    const local = await cacheRemoteImageForShare(remote);
                    if (local) localMap.set(id, local);
                }),
            );
            setShareAvatarLocals(localMap);
            setShareFrame(true);
            await waitForShareAvatars([...localMap.values()]);
            try {
                await shareTournamentPitchImage({
                    pitchRef: pitchShareRef,
                    planId,
                    message,
                    teamUrl: planShareUrl(planId),
                });
            } finally {
                setShareFrame(false);
                setShareAvatarLocals(null);
            }
        },
        [peopleById, planId, slots, teamIndex],
    );

    /** Invitar clase: mensaje de esa clase, pero link sin team= (siempre eligen al abrir). */
    const shareTeamInvite = useCallback(async () => {
        if (!config) return;
        hapticSelection();
        const name = config.equipos[teamIndex]?.nombre ?? `Equipo ${teamIndex + 1}`;
        await captureAndShare(t('torneo.shareTeamMsg', { team: name }));
    }, [captureAndShare, config, t, teamIndex]);

    /** Share general (arriba / tarjeta): campo más lleno, sin team=, mensaje torneo. */
    const shareTournamentGeneral = useCallback(async () => {
        if (!config) return;
        hapticSelection();
        const prev = teamIndex;
        const fullest = fullestTeamIndex(config, slots);
        if (fullest !== prev) {
            setTeamIndex(fullest);
            await sleep(280);
        }
        await captureAndShare(t('torneo.shareAllMsg'));
        if (fullest !== prev) setTeamIndex(prev);
    }, [captureAndShare, config, slots, t, teamIndex]);

    useEffect(() => {
        setTournamentShareHandler(shareTournamentGeneral);
        return () => setTournamentShareHandler(null);
    }, [shareTournamentGeneral]);

    if (!config) return null;

    const starters = startersCount(config);
    const team = config.equipos[teamIndex];
    const pitchSlots = teamStarterSlots(config);
    const afIdx = aficionTeamIndex(config);
    const ulIdx = ultrasTeamIndex(config);
    const aficionCap = Math.max(0, config.aficion ?? DEFAULT_TOURNAMENT_AFICION);
    const ultrasCap = Math.max(0, config.ultras ?? DEFAULT_TOURNAMENT_ULTRAS);
    const mySlot = currentUserId
        ? slots.find((s) => String(s.usuario_id) === String(currentUserId))
        : undefined;
    const teamColor = team?.color ?? '#FFFFFF';
    const captainId =
        team?.capitan_id ??
        slots
            .filter((s) => s.equipo === teamIndex)
            .sort((a, b) => a.posicion - b.posicion)[0]?.usuario_id ??
        null;

    const onPressSlot = async (posicion: number, equipo = teamIndex) => {
        const occupant = slots.find((s) => s.equipo === equipo && s.posicion === posicion);
        if (occupant) {
            const teamCap =
                config.equipos[equipo]?.capitan_id ??
                slots
                    .filter((s) => s.equipo === equipo)
                    .sort((a, b) => a.posicion - b.posicion)[0]?.usuario_id;
            const captainOfTeam =
                !isFansTeam(config, equipo) &&
                !!currentUserId &&
                (isCreator || teamCap === currentUserId);
            if (captainOfTeam && occupant.usuario_id !== currentUserId) {
                Alert.alert(t('torneo.kickTitle'), t('torneo.kickBody'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('torneo.kickConfirm'),
                        style: 'destructive',
                        onPress: () => {
                            void (async () => {
                                const snapshot = slots;
                                setSlots((prev) => {
                                    const next = prev.filter(
                                        (s) =>
                                            String(s.usuario_id) !== String(occupant.usuario_id),
                                    );
                                    seedTournamentLineup(planId, config, next);
                                    return next;
                                });
                                const { error } = await kickTournamentSlot(
                                    planId,
                                    occupant.usuario_id,
                                );
                                if (error) {
                                    setSlots(snapshot);
                                    seedTournamentLineup(planId, config, snapshot);
                                    hapticError();
                                    return;
                                }
                                hapticSuccess();
                            })();
                        },
                    },
                ]);
                return;
            }
            hapticLight();
            onOpenProfile(occupant.usuario_id);
            return;
        }
        // Hueco vacío: unirse al toque (también desde link sin ser miembro aún).
        if (viewerIsOrganizer || !allowPick) return;
        if (requireAccount?.()) return;
        if (!currentUserId) return;
        if (claimInFlight.current) {
            hapticLight();
            return;
        }
        const snapshot = slots;
        const configSnapshot = config;
        const teamName =
            isFansTeam(config, equipo)
                ? t('torneo.fans')
                : (config.equipos[equipo]?.nombre ?? t('torneo.tabSquads'));
        claimInFlight.current = true;
        applyOptimisticClaim(equipo, posicion);
        hapticSuccess();
        presentInAppToast({
            id: `torneo-join:${planId}`,
            title: t('torneo.joinedToast', { team: teamName }),
            body: t('torneo.joinedToastBody'),
        });
        suppressReloadUntil.current = Date.now() + 900;
        try {
            if (ensureJoined) {
                const ok = await ensureJoined();
                if (!ok) {
                    setSlots(snapshot);
                    setConfig(configSnapshot);
                    seedTournamentLineup(planId, configSnapshot, snapshot);
                    setAutoJoinedTeam(false);
                    return;
                }
            }
            const { error } = await claimTournamentSlot(planId, equipo, posicion);
            if (error) {
                setSlots(snapshot);
                setConfig(configSnapshot);
                seedTournamentLineup(planId, configSnapshot, snapshot);
                hapticError();
                await sleep(80);
                Alert.alert(
                    t('feed.error'),
                    /unique|duplicate|slot|ocupad|taken/i.test(error)
                        ? t('futbol.slotTaken')
                        : t('feed.joinError'),
                );
                void load(true);
            }
        } finally {
            claimInFlight.current = false;
        }
    };

    const pitchProps = {
        styles,
        pitchSlots,
        starters,
        teamIndex,
        teamColor,
        captainId,
        slots,
        peopleById,
        snapshotFriendly: shareFrame,
        shareAvatarLocals,
        onPressSlot: (pos: number) => void onPressSlot(pos),
    };

    const renameTeam = (idx: number, nombre: string, commit: boolean) => {
        if (!isCreator) return;
        const equipos = config.equipos.map((e, i) => (i === idx ? { ...e, nombre } : e));
        const next = { ...config, equipos };
        setConfig(next);
        if (commit) void persist(next);
    };

    return (
        <View style={styles.section}>
            <View style={styles.tabsWrap}>
                <View style={styles.tabs}>
                    <TouchableOpacity
                        style={[styles.tab, tab === 'squads' && styles.tabOn]}
                        onPress={() => setTab('squads')}
                        activeOpacity={0.88}
                    >
                        <Ionicons
                            name="people"
                            size={20}
                            color={tab === 'squads' ? '#FFF' : '#64748B'}
                        />
                        <Text style={[styles.tabText, tab === 'squads' && styles.tabTextOn]}>
                            {t('torneo.tabSquads')}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tab, tab === 'league' && styles.tabOn]}
                        onPress={() => setTab('league')}
                        activeOpacity={0.88}
                    >
                        <Ionicons
                            name="trophy-outline"
                            size={20}
                            color={tab === 'league' ? '#FFF' : '#64748B'}
                        />
                        <Text style={[styles.tabText, tab === 'league' && styles.tabTextOn]}>
                            {t('torneo.tabBracket')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {tab === 'squads' ? (
                <>
                    <View style={styles.statusList}>
                        {teamStats.map((s) => {
                            const tm = config.equipos[s.equipo];
                            return (
                                <Pressable
                                    key={s.equipo}
                                    style={[
                                        styles.statusChip,
                                        teamIndex === s.equipo && styles.statusChipOn,
                                    ]}
                                    onPress={() => {
                                        hapticLight();
                                        setTeamIndex(s.equipo);
                                    }}
                                >
                                    <View
                                        style={[
                                            styles.statusDot,
                                            { backgroundColor: tm?.color ?? '#94A3B8' },
                                            isLightColor(tm?.color ?? '') && styles.dotLight,
                                        ]}
                                    />
                                    <Text style={styles.statusName} numberOfLines={1}>
                                        {tm?.nombre ?? `E${s.equipo + 1}`}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    <View style={styles.teamHeader}>
                        <View style={styles.teamTitleCol}>
                            <View style={styles.teamTitleRow}>
                                <View
                                    style={[
                                        styles.teamBar,
                                        { backgroundColor: teamColor },
                                        isLightColor(teamColor) && styles.dotLight,
                                    ]}
                                />
                                {isCreator ? (
                                    <TextInput
                                        value={team?.nombre ?? ''}
                                        onChangeText={(nombre) =>
                                            renameTeam(teamIndex, nombre, false)
                                        }
                                        onEndEditing={(e) =>
                                            renameTeam(teamIndex, e.nativeEvent.text, true)
                                        }
                                        style={styles.teamNameInput}
                                        maxLength={22}
                                        placeholder={t('futbol.teamNamePlaceholder')}
                                        placeholderTextColor="#94A3B8"
                                    />
                                ) : (
                                    <Text style={styles.teamName}>{team?.nombre}</Text>
                                )}
                            </View>
                            {(() => {
                                const filled = slots.filter((s) => s.equipo === teamIndex).length;
                                const capacity = startersCount(config) + config.banquillo;
                                const vibe = teamVibeFor(
                                    planId,
                                    teamIndex,
                                    config.equipos.length,
                                    filled,
                                    capacity,
                                );
                                return (
                                    <View style={styles.teamVibe}>
                                        <Ionicons name={vibe.icon} size={13} color="#EA580C" />
                                        <Text style={styles.teamVibeText} numberOfLines={1}>
                                            {vibe.text}
                                        </Text>
                                    </View>
                                );
                            })()}
                        </View>
                        <TouchableOpacity
                            style={styles.shareBtn}
                            onPress={() => void shareTeamInvite()}
                            hitSlop={8}
                        >
                            <Ionicons name="share-outline" size={18} color="#2563EB" />
                            <Text style={styles.shareText}>{t('torneo.inviteClass')}</Text>
                        </TouchableOpacity>
                    </View>

                    {allowPick && !mySlot ? (
                        <TouchableOpacity
                            style={styles.chooseClassBtn}
                            onPress={() => setPickOpen(true)}
                            activeOpacity={0.88}
                        >
                            <Ionicons name="people" size={18} color="#FFF" />
                            <Text style={styles.chooseClassText}>{t('torneo.chooseClass')}</Text>
                        </TouchableOpacity>
                    ) : null}

                    {/* Captura = solo el campo, mismo margen/letterbox de siempre. */}
                    <View
                        ref={pitchShareRef}
                        collapsable={false}
                        style={shareFrame ? styles.shareCapture : undefined}
                    >
                        {shareFrame ? <View style={styles.shareLetterbox} /> : null}
                        <HalfPitch {...pitchProps} />
                        {shareFrame ? <View style={styles.shareLetterbox} /> : null}
                    </View>

                    <View style={styles.panelCard}>
                        <View style={styles.panelHead}>
                            <View style={styles.panelAccent} />
                            <Text style={styles.panelTitle}>{t('torneo.bench')}</Text>
                        </View>
                        <View style={styles.benchRowSingle}>
                            {Array.from({ length: config.banquillo }, (_, i) => {
                                const posicion = starters + i;
                                const occ = slots.find(
                                    (s) => s.equipo === teamIndex && s.posicion === posicion,
                                );
                                const person = occ ? peopleById.get(String(occ.usuario_id)) : null;
                                const isCap = !!occ && !!captainId && occ.usuario_id === captainId;
                                return (
                                    <View key={posicion} style={styles.benchFlexCell}>
                                        <PersonBubble
                                            styles={styles}
                                            occupied={!!occ}
                                            person={person}
                                            userId={occ?.usuario_id}
                                            teamColor={teamColor}
                                            isCaptain={isCap}
                                            onPanel
                                            compact
                                            onPress={() => void onPressSlot(posicion)}
                                        />
                                    </View>
                                );
                            })}
                        </View>
                    </View>

                    <View style={styles.panelCard}>
                        <View style={styles.panelHead}>
                            <View style={[styles.panelAccent, { backgroundColor: '#0EA5E9' }]} />
                            <Text style={styles.panelTitle}>{t('torneo.fans')}</Text>
                            <Text style={styles.panelMeta}>
                                {(aficionStat?.filled ?? 0) + (ultrasStat?.filled ?? 0)}/
                                {(aficionStat?.capacity ?? 0) + (ultrasStat?.capacity ?? 0)}
                            </Text>
                        </View>
                        {ultrasCap > 0 ? (
                            <>
                                <View style={styles.ultrasInlineHead}>
                                    <Ionicons name="flame" size={14} color="#EF4444" />
                                    <Text style={styles.ultrasInlineTitle}>{t('torneo.ultras')}</Text>
                                    {ultrasStat ? (
                                        <Text style={styles.panelMeta}>
                                            {ultrasStat.filled}/{ultrasStat.capacity}
                                        </Text>
                                    ) : null}
                                </View>
                                <View style={styles.benchRowSingle}>
                                    {Array.from({ length: ultrasCap }, (_, posicion) => {
                                        const occ = slots.find(
                                            (s) => s.equipo === ulIdx && s.posicion === posicion,
                                        );
                                        const person = occ ? peopleById.get(String(occ.usuario_id)) : null;
                                        return (
                                            <View key={`ul-${posicion}`} style={styles.benchFlexCell}>
                                                <PersonBubble
                                                    styles={styles}
                                                    occupied={!!occ}
                                                    person={person}
                                                    userId={occ?.usuario_id}
                                                    teamColor="#EF4444"
                                                    dashedEmpty
                                                    onPanel
                                                    compact
                                                    onPress={() => void onPressSlot(posicion, ulIdx)}
                                                />
                                            </View>
                                        );
                                    })}
                                </View>
                            </>
                        ) : null}
                        <View style={styles.aficionGrid}>
                            {Array.from({ length: aficionCap }, (_, posicion) => {
                                const occ = slots.find(
                                    (s) => s.equipo === afIdx && s.posicion === posicion,
                                );
                                const person = occ ? peopleById.get(String(occ.usuario_id)) : null;
                                return (
                                    <View key={`af-${posicion}`} style={styles.aficionCell}>
                                        <PersonBubble
                                            styles={styles}
                                            occupied={!!occ}
                                            person={person}
                                            userId={occ?.usuario_id}
                                            teamColor="#0EA5E9"
                                            dashedEmpty
                                            onPanel
                                            compact
                                            onPress={() => void onPressSlot(posicion, afIdx)}
                                        />
                                    </View>
                                );
                            })}
                        </View>
                    </View>

                    {mySlot ? (
                        <TouchableOpacity
                            style={styles.leaveBtn}
                            disabled={busy}
                            onPress={() => {
                                void (async () => {
                                    const snapshot = slots;
                                    setSlots((prev) => {
                                        const next = prev.filter(
                                            (s) => String(s.usuario_id) !== String(currentUserId),
                                        );
                                        seedTournamentLineup(planId, config, next);
                                        return next;
                                    });
                                    setAutoJoinedTeam(false);
                                    const { error } = await releaseFootballSlot(planId);
                                    if (error) {
                                        setSlots(snapshot);
                                        seedTournamentLineup(planId, config, snapshot);
                                        return;
                                    }
                                    setPickOpen(true);
                                })();
                            }}
                        >
                            <Text style={styles.leaveText}>{t('futbol.leaveSlot')}</Text>
                        </TouchableOpacity>
                    ) : null}

                    {allowPick && !mySlot ? (
                        <Text style={styles.hint}>{t('torneo.tapSlot')}</Text>
                    ) : viewerIsOrganizer ? (
                        <Text style={styles.hint}>{t('organizer.cannotJoinHint')}</Text>
                    ) : null}

                    {isCreator ? (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.colorRow}
                        >
                            {TEAM_COLORS.map((color) => (
                                <Pressable
                                    key={color}
                                    onPress={() => {
                                        const equipos = config.equipos.map((e, i) =>
                                            i === teamIndex ? { ...e, color } : e,
                                        );
                                        void persist({ ...config, equipos });
                                    }}
                                    style={[
                                        styles.colorDot,
                                        { backgroundColor: color },
                                        isLightColor(color) && styles.dotLight,
                                        team?.color === color && styles.colorDotOn,
                                    ]}
                                />
                            ))}
                        </ScrollView>
                    ) : null}
                </>
            ) : (
                <>
                    <LeagueTable
                        config={config}
                        styles={styles}
                        isCreator={isCreator}
                        onRenameTeam={renameTeam}
                        onUpdateStanding={(equipo, patch) => {
                            const next = updateStanding(config, equipo, patch);
                            setConfig(next);
                            void persist(next);
                        }}
                    />
                </>
            )}

            {/* Un solo mount: no remonta al cambiar pestaña (evita flicker / doble fetch). */}
            <TournamentChampionPoll
                planId={planId}
                config={config}
                currentUserId={currentUserId}
                canVote={!viewerIsOrganizer}
                requireAccount={requireAccount}
            />

            <Modal
                visible={pickOpen && !!config}
                transparent
                animationType="fade"
                onRequestClose={() => setPickOpen(false)}
            >
                <View style={styles.pickBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setPickOpen(false)} />
                    <View style={styles.pickCard}>
                        <View style={styles.pickHeader}>
                            <View style={styles.pickHeaderIcon}>
                                <Ionicons name="shirt-outline" size={22} color="#FFF" />
                            </View>
                            <View style={styles.pickHeaderText}>
                                <Text style={styles.pickTitle}>{t('torneo.chooseClassTitle')}</Text>
                                <Text style={styles.pickSub}>{t('torneo.chooseClassSub')}</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => setPickOpen(false)}
                                hitSlop={10}
                                style={styles.pickClose}
                            >
                                <Ionicons name="close" size={20} color="#94A3B8" />
                            </TouchableOpacity>
                        </View>
                        <ScrollView
                            style={styles.pickScroll}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.pickScrollContent}
                        >
                            {teamStats.map((s) => {
                                const tm = config.equipos[s.equipo];
                                const full = s.filled >= s.capacity;
                                const pct =
                                    s.capacity > 0
                                        ? Math.min(1, s.filled / s.capacity)
                                        : 0;
                                const color = tm?.color ?? '#94A3B8';
                                return (
                                    <TouchableOpacity
                                        key={s.equipo}
                                        style={[styles.pickTeamCard, full && styles.pickRowDisabled]}
                                        disabled={full}
                                        onPress={() => void claimIntoTeam(s.equipo)}
                                        activeOpacity={0.88}
                                    >
                                        <View
                                            style={[
                                                styles.pickTeamStripe,
                                                { backgroundColor: color },
                                                isLightColor(color) && styles.dotLight,
                                            ]}
                                        />
                                        <View style={styles.pickTeamBody}>
                                            <View style={styles.pickTeamTop}>
                                                <View
                                                    style={[
                                                        styles.pickTeamBadge,
                                                        { backgroundColor: color },
                                                        isLightColor(color) && styles.dotLight,
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.pickTeamBadgeText,
                                                            isLightColor(color) && {
                                                                color: '#0F172A',
                                                            },
                                                        ]}
                                                    >
                                                        {(tm?.nombre ?? 'E').slice(0, 1).toUpperCase()}
                                                    </Text>
                                                </View>
                                                <Text style={styles.pickName} numberOfLines={1}>
                                                    {tm?.nombre}
                                                </Text>
                                                <View
                                                    style={[
                                                        styles.pickCountPill,
                                                        full && styles.pickCountPillFull,
                                                        s.complete && !full && styles.pickCountPillOk,
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.pickCountPillText,
                                                            full && styles.pickCountPillTextFull,
                                                        ]}
                                                    >
                                                        {s.filled}/{s.capacity}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.pickProgressTrack}>
                                                <View
                                                    style={[
                                                        styles.pickProgressFill,
                                                        {
                                                            width: `${Math.round(pct * 100)}%`,
                                                            backgroundColor: full
                                                                ? '#94A3B8'
                                                                : '#2563EB',
                                                        },
                                                    ]}
                                                />
                                            </View>
                                        </View>
                                        <Ionicons
                                            name="chevron-forward"
                                            size={18}
                                            color={full ? '#CBD5E1' : '#64748B'}
                                        />
                                    </TouchableOpacity>
                                );
                            })}

                            {(() => {
                                const filled = fansFilledCount(config, slots);
                                const cap = fansCapacity(config);
                                const full = filled >= cap;
                                const pct = cap > 0 ? Math.min(1, filled / cap) : 0;
                                return (
                                    <TouchableOpacity
                                        style={[
                                            styles.pickFansCard,
                                            full && styles.pickRowDisabled,
                                        ]}
                                        disabled={full}
                                        onPress={() => void claimIntoTeam(afIdx)}
                                        activeOpacity={0.88}
                                    >
                                        <View style={styles.pickFansIcon}>
                                            <Ionicons name="people" size={20} color="#0EA5E9" />
                                        </View>
                                        <View style={styles.pickTeamBody}>
                                            <View style={styles.pickTeamTop}>
                                                <Text style={styles.pickName}>{t('torneo.fans')}</Text>
                                                <View
                                                    style={[
                                                        styles.pickCountPill,
                                                        full && styles.pickCountPillFull,
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.pickCountPillText,
                                                            full && styles.pickCountPillTextFull,
                                                        ]}
                                                    >
                                                        {filled}/{cap}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.pickProgressTrack}>
                                                <View
                                                    style={[
                                                        styles.pickProgressFill,
                                                        {
                                                            width: `${Math.round(pct * 100)}%`,
                                                            backgroundColor: full
                                                                ? '#94A3B8'
                                                                : '#0EA5E9',
                                                        },
                                                    ]}
                                                />
                                            </View>
                                        </View>
                                        <Ionicons
                                            name="chevron-forward"
                                            size={18}
                                            color={full ? '#CBD5E1' : '#0EA5E9'}
                                        />
                                    </TouchableOpacity>
                                );
                            })()}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function PersonBubble({
    styles,
    occupied,
    person,
    userId,
    teamColor,
    isCaptain,
    dashedEmpty,
    onPanel,
    compact,
    snapshotFriendly,
    shareUri,
    onPress,
}: {
    styles: ReturnType<typeof createStyles>;
    occupied: boolean;
    person?: Person | null;
    userId?: string;
    teamColor: string;
    isCaptain?: boolean;
    dashedEmpty?: boolean;
    onPanel?: boolean;
    compact?: boolean;
    snapshotFriendly?: boolean;
    shareUri?: string | null;
    onPress: () => void;
}) {
    const size = compact ? 52 : AVATAR;
    return (
        <TouchableOpacity
            style={[styles.benchSlot, compact && styles.benchSlotCompact, styles.benchSlotCenter]}
            onPress={onPress}
            activeOpacity={0.85}
        >
            <View style={[styles.bubbleWrap, { width: size, height: size }]}>
                {occupied ? (
                    <View
                        style={[
                            styles.avatarRing,
                            {
                                borderColor: borderForTeam(teamColor),
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                            },
                        ]}
                    >
                        <ProfileAvatar
                            uri={shareUri || person?.avatar_url}
                            name={person?.nombre || '?'}
                            size={size - 6}
                            recyclingKey={userId}
                            snapshotFriendly={snapshotFriendly}
                        />
                    </View>
                ) : (
                    <View
                        style={[
                            onPanel ? styles.panelEmpty : styles.slotEmpty,
                            dashedEmpty && styles.slotEmptyDashed,
                            {
                                borderColor: borderForTeam(teamColor),
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                            },
                        ]}
                    >
                        <Ionicons
                            name="add"
                            size={compact ? 18 : 22}
                            color={onPanel ? '#94A3B8' : 'rgba(255,255,255,0.85)'}
                        />
                    </View>
                )}
                {isCaptain ? (
                    <View style={styles.captainBadge}>
                        <Text style={styles.captainBadgeText}>C</Text>
                    </View>
                ) : null}
            </View>
            {occupied ? (
                <Text style={styles.benchName} numberOfLines={1}>
                    {shortName(person?.nombre) || ' '}
                </Text>
            ) : null}
        </TouchableOpacity>
    );
}

function HalfPitch({
    styles,
    pitchSlots,
    starters,
    teamIndex,
    teamColor,
    captainId,
    slots,
    peopleById,
    snapshotFriendly = false,
    shareAvatarLocals = null,
    onPressSlot,
}: {
    styles: ReturnType<typeof createStyles>;
    pitchSlots: { x: number; y: number }[];
    starters: number;
    teamIndex: number;
    teamColor: string;
    captainId: string | null;
    slots: TournamentOccupant[];
    peopleById: Map<string, Person>;
    snapshotFriendly?: boolean;
    shareAvatarLocals?: Map<string, string> | null;
    onPressSlot: (posicion: number) => void;
}) {
    const [size, setSize] = useState({ w: 0, h: 0 });
    return (
        <View
            style={styles.pitch}
            onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                const h = Math.round(e.nativeEvent.layout.height);
                if (w > 0 && h > 0 && (w !== size.w || h !== size.h)) setSize({ w, h });
            }}
        >
            {size.h > 0
                ? Array.from({ length: 8 }, (_, i) => (
                      <View
                          key={i}
                          pointerEvents="none"
                          style={[
                              styles.stripe,
                              {
                                  top: (size.h * i) / 8,
                                  height: size.h / 8,
                                  backgroundColor: i % 2 === 0 ? '#166534' : '#15803D',
                              },
                          ]}
                      />
                  ))
                : null}
            <View style={styles.pitchBorder} pointerEvents="none" />
            {/* Semicírculo del medio campo (mitad superior). */}
            {size.w > 0 ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.centerArc,
                        {
                            left: size.w * 0.5 - size.w * 0.16,
                            width: size.w * 0.32,
                            height: size.w * 0.16,
                        },
                    ]}
                />
            ) : null}
            {/* Área grande abajo (abierta por abajo) + área chica + arco. */}
            {size.w > 0 ? (
                <>
                    <View
                        pointerEvents="none"
                        style={[
                            styles.goalArea,
                            {
                                left: size.w * 0.18,
                                width: size.w * 0.64,
                                height: size.h * 0.2,
                                bottom: 0,
                            },
                        ]}
                    />
                    <View
                        pointerEvents="none"
                        style={[
                            styles.penaltyArc,
                            {
                                left: size.w * 0.5 - size.w * 0.12,
                                width: size.w * 0.24,
                                height: size.w * 0.12,
                                bottom: size.h * 0.2 - 1,
                            },
                        ]}
                    />
                    <View
                        pointerEvents="none"
                        style={[
                            styles.goalSmallArea,
                            {
                                left: size.w * 0.32,
                                width: size.w * 0.36,
                                height: size.h * 0.09,
                                bottom: 0,
                            },
                        ]}
                    />
                </>
            ) : null}
            {size.w > 0
                ? pitchSlots.slice(0, starters).map((slot, posicion) => {
                      const occ = slots.find(
                          (s) => s.equipo === teamIndex && s.posicion === posicion,
                      );
                      const person = occ ? peopleById.get(String(occ.usuario_id)) : null;
                      const isCap = !!occ && !!captainId && occ.usuario_id === captainId;
                      // Invertir: portería abajo. Layouts ~0.07–0.45 → y alto arriba, bajo abajo.
                      const yFromTop = 1 - slot.y / 0.48;
                      let ySpread = 0.08 + yFromTop * 0.72;
                      // 7v7: GK/centrales/media punta; el del medio (pivote) bastante más abajo.
                      if (starters === 7) {
                          if (posicion === 0) ySpread += 0.045;
                          else if (posicion === 1 || posicion === 2) ySpread += 0.038;
                          else if (posicion === 4) ySpread += 0.12;
                          else if (posicion === 6) ySpread += 0.055;
                      }
                      const xSpread = 0.5 + (slot.x - 0.5) * 1.12;
                      const left = Math.min(
                          size.w - AVATAR - 4,
                          Math.max(4, xSpread * size.w - AVATAR / 2),
                      );
                      const top = Math.min(
                          size.h - SLOT_H - 8,
                          Math.max(6, ySpread * size.h - AVATAR / 2),
                      );
                      return (
                          <TouchableOpacity
                              key={posicion}
                              style={[styles.slot, { left, top }]}
                              onPress={() => onPressSlot(posicion)}
                              activeOpacity={0.85}
                          >
                              <View style={styles.bubbleWrap}>
                                  {occ ? (
                                      <View
                                          style={[
                                              styles.avatarRing,
                                              { borderColor: borderForTeam(teamColor) },
                                          ]}
                                      >
                                          <ProfileAvatar
                                              uri={
                                                  shareAvatarLocals?.get(String(occ.usuario_id)) ??
                                                  person?.avatar_url
                                              }
                                              name={person?.nombre || '?'}
                                              size={AVATAR - 6}
                                              recyclingKey={occ.usuario_id}
                                              snapshotFriendly={snapshotFriendly}
                                          />
                                      </View>
                                  ) : (
                                      <View
                                          style={[
                                              styles.slotEmpty,
                                              { borderColor: borderForTeam(teamColor) },
                                          ]}
                                      />
                                  )}
                                  {isCap ? (
                                      <View style={styles.captainBadge}>
                                          <Text style={styles.captainBadgeText}>C</Text>
                                      </View>
                                  ) : null}
                              </View>
                              {occ ? (
                                  <Text style={styles.slotName} numberOfLines={1}>
                                      {shortName(person?.nombre) || ' '}
                                  </Text>
                              ) : null}
                          </TouchableOpacity>
                      );
                  })
                : null}
        </View>
    );
}

function LeagueTable({
    config,
    styles,
    isCreator,
    onRenameTeam,
    onUpdateStanding,
}: {
    config: TournamentConfig;
    styles: ReturnType<typeof createStyles>;
    isCreator: boolean;
    onRenameTeam: (idx: number, nombre: string, commit: boolean) => void;
    onUpdateStanding: (equipo: number, patch: Partial<LeagueStanding>) => void;
}) {
    const { t } = useT();

    const rows = useMemo(() => {
        return config.equipos
            .map((team, equipo) => ({
                equipo,
                team,
                row: config.clasificacion[equipo] ?? { pts: 0, pj: 0, gf: 0, gc: 0 },
            }))
            .sort((a, b) => {
                if (b.row.pts !== a.row.pts) return b.row.pts - a.row.pts;
                const dga = a.row.gf - a.row.gc;
                const dgb = b.row.gf - b.row.gc;
                if (dgb !== dga) return dgb - dga;
                return b.row.gf - a.row.gf;
            });
    }, [config.clasificacion, config.equipos]);

    return (
        <View style={styles.leagueWrap}>
            {isCreator ? (
                <View style={styles.renameBlock}>
                    <Text style={styles.leagueRenameTitle}>{t('torneo.teamNames')}</Text>
                    {config.equipos.map((e, i) => (
                        <TextInput
                            key={`rename-${i}`}
                            style={styles.renameInput}
                            value={e.nombre}
                            onChangeText={(nombre) => onRenameTeam(i, nombre, false)}
                            onEndEditing={(ev) => onRenameTeam(i, ev.nativeEvent.text, true)}
                            maxLength={22}
                        />
                    ))}
                </View>
            ) : null}

            <View style={styles.leagueCard}>
                <View style={styles.leagueCardTop}>
                    <View style={styles.leagueCardTopIcon}>
                        <Ionicons name="trophy" size={18} color="#F59E0B" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.leagueCardTitle}>{t('torneo.tabBracket')}</Text>
                        <Text style={styles.leagueHint}>{t('torneo.leagueHint')}</Text>
                    </View>
                </View>
                <View style={styles.leagueHeader}>
                    <View style={styles.leagueAccentSpacer} />
                    <Text style={[styles.leagueTh, styles.colPos]}>#</Text>
                    <Text style={[styles.leagueTh, styles.colTeam]}>{t('torneo.leagueTeam')}</Text>
                    <Text style={[styles.leagueTh, styles.colStat]}>PTS</Text>
                    <Text style={[styles.leagueTh, styles.colStat]}>PJ</Text>
                    <Text style={[styles.leagueTh, styles.colStat]}>GF</Text>
                    <Text style={[styles.leagueTh, styles.colStat]}>GC</Text>
                </View>
                {rows.map((r, rank) => {
                    const podium =
                        rank === 0 ? 'gold' : rank === 1 ? 'silver' : rank === 2 ? 'bronze' : null;
                    return (
                        <View
                            key={r.equipo}
                            style={[
                                styles.leagueRow,
                                rank === 0 && styles.leagueRowLead,
                                rank % 2 === 1 && rank !== 0 && styles.leagueRowAlt,
                            ]}
                        >
                            <View
                                style={[
                                    styles.leagueAccent,
                                    { backgroundColor: r.team.color },
                                    isLightColor(r.team.color) && styles.leagueAccentLight,
                                ]}
                            />
                            <View
                                style={[
                                    styles.rankBadge,
                                    podium === 'gold' && styles.rankGold,
                                    podium === 'silver' && styles.rankSilver,
                                    podium === 'bronze' && styles.rankBronze,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.rankBadgeText,
                                        podium != null && styles.rankBadgeTextOn,
                                    ]}
                                >
                                    {rank + 1}
                                </Text>
                            </View>
                            <View style={[styles.colTeam, styles.teamCell]}>
                                <Text style={styles.leagueTeamName} numberOfLines={1}>
                                    {r.team.nombre}
                                </Text>
                            </View>
                            <StatCell
                                styles={styles}
                                value={r.row.pts}
                                editable={isCreator}
                                emphasis
                                onCommit={(pts) => onUpdateStanding(r.equipo, { pts })}
                            />
                            <StatCell
                                styles={styles}
                                value={r.row.pj}
                                editable={isCreator}
                                onCommit={(pj) => onUpdateStanding(r.equipo, { pj })}
                            />
                            <StatCell
                                styles={styles}
                                value={r.row.gf}
                                editable={isCreator}
                                onCommit={(gf) => onUpdateStanding(r.equipo, { gf })}
                            />
                            <StatCell
                                styles={styles}
                                value={r.row.gc}
                                editable={isCreator}
                                onCommit={(gc) => onUpdateStanding(r.equipo, { gc })}
                            />
                        </View>
                    );
                })}
            </View>
            {!isCreator ? (
                <Text style={styles.hint}>{t('torneo.leagueReadonly')}</Text>
            ) : (
                <Text style={styles.hint}>{t('torneo.leagueEditHint')}</Text>
            )}
        </View>
    );
}

function StatCell({
    styles,
    value,
    editable,
    emphasis,
    onCommit,
}: {
    styles: ReturnType<typeof createStyles>;
    value: number;
    editable: boolean;
    emphasis?: boolean;
    onCommit: (n: number) => void;
}) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    if (!editable) {
        return (
            <Text
                style={[
                    styles.leagueTd,
                    styles.colStat,
                    emphasis && styles.leaguePts,
                ]}
            >
                {value}
            </Text>
        );
    }
    return (
        <TextInput
            style={[styles.statInput, emphasis && styles.statInputPts]}
            value={draft}
            keyboardType="number-pad"
            maxLength={3}
            onChangeText={setDraft}
            onEndEditing={() => {
                const n = parseInt(draft, 10);
                onCommit(Number.isFinite(n) ? n : 0);
            }}
        />
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
        section: {
            marginTop: 4,
            marginBottom: 12,
            paddingHorizontal: 16,
            gap: 12,
        },
        headRow: { gap: 12 },
        title: { fontSize: 20, fontWeight: '800', color: c.text },
        tabsWrap: { alignItems: 'center' },
        tabs: {
            flexDirection: 'row',
            gap: 12,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 20,
            padding: 6,
            alignSelf: 'center',
        },
        tab: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 22,
            paddingVertical: 14,
            borderRadius: 16,
            minWidth: 148,
            justifyContent: 'center',
        },
        tabOn: {
            backgroundColor: '#2563EB',
            shadowColor: '#2563EB',
            shadowOpacity: 0.35,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
        },
        tabText: { fontWeight: '800', color: c.textMuted, fontSize: 16 },
        tabTextOn: { color: '#FFF' },
        statusList: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'flex-start',
        },
        statusChip: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingHorizontal: 10,
            paddingVertical: 10,
            borderRadius: 14,
            backgroundColor: c.surface,
            borderWidth: 1.5,
            borderColor: c.border,
            width: '31.2%',
            shadowColor: '#0F172A',
            shadowOpacity: 0.04,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 1,
        },
        statusChipOn: {
            borderColor: '#2563EB',
            backgroundColor: '#EFF6FF',
            shadowColor: '#2563EB',
            shadowOpacity: 0.18,
            shadowRadius: 6,
            elevation: 2,
        },
        statusDot: { width: 12, height: 12, borderRadius: 6 },
        statusName: { flexShrink: 1, fontSize: 12, fontWeight: '800', color: c.text },
        teamHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
        },
        teamTitleCol: { flex: 1, gap: 4, minWidth: 0 },
        teamTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        teamVibe: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            marginLeft: 14,
            paddingRight: 4,
        },
        teamVibeText: {
            flexShrink: 1,
            fontSize: 12,
            fontWeight: '800',
            color: '#C2410C',
            letterSpacing: 0.1,
        },
        teamBar: { width: 6, height: 22, borderRadius: 3 },
        teamName: { fontSize: 16, fontWeight: '800', color: c.text, flexShrink: 1 },
        teamNameInput: {
            flex: 1,
            fontSize: 16,
            fontWeight: '800',
            color: c.text,
            paddingVertical: 0,
        },
        shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        shareText: { color: '#2563EB', fontWeight: '700', fontSize: 13 },
        chooseClassBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: '#2563EB',
            borderRadius: 14,
            paddingVertical: 12,
        },
        chooseClassText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
        shareCapture: {
            backgroundColor: '#0B1220',
            borderRadius: 18,
            paddingHorizontal: 8,
            overflow: 'hidden',
        },
        shareLetterbox: {
            height: 16,
            backgroundColor: '#0B1220',
        },
        pitch: {
            height: 420,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: '#15803D',
            position: 'relative',
        },
        stripe: { position: 'absolute', left: 0, right: 0 },
        pitchBorder: {
            ...StyleSheet.absoluteFillObject,
            borderWidth: 2.5,
            borderColor: 'rgba(255,255,255,0.85)',
            borderRadius: 18,
        },
        centerArc: {
            position: 'absolute',
            top: 0,
            borderWidth: 2.5,
            borderTopWidth: 0,
            borderColor: 'rgba(255,255,255,0.95)',
            borderBottomLeftRadius: 999,
            borderBottomRightRadius: 999,
            backgroundColor: 'transparent',
        },
        goalArea: {
            position: 'absolute',
            borderWidth: 2.5,
            borderBottomWidth: 0,
            borderColor: 'rgba(255,255,255,0.95)',
            backgroundColor: 'transparent',
        },
        goalSmallArea: {
            position: 'absolute',
            borderWidth: 2.5,
            borderBottomWidth: 0,
            borderColor: 'rgba(255,255,255,0.95)',
            backgroundColor: 'transparent',
        },
        penaltyArc: {
            position: 'absolute',
            borderWidth: 2.5,
            borderBottomWidth: 0,
            borderColor: 'rgba(255,255,255,0.95)',
            borderTopLeftRadius: 999,
            borderTopRightRadius: 999,
            backgroundColor: 'transparent',
        },
        slot: {
            position: 'absolute',
            width: AVATAR + 10,
            height: SLOT_H,
            alignItems: 'center',
            justifyContent: 'flex-start',
        },
        bubbleWrap: {
            width: AVATAR,
            height: AVATAR,
            alignItems: 'center',
            justifyContent: 'center',
        },
        avatarRing: {
            width: AVATAR,
            height: AVATAR,
            borderRadius: AVATAR / 2,
            borderWidth: 3,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.12)',
            overflow: 'hidden',
        },
        slotEmpty: {
            width: AVATAR,
            height: AVATAR,
            borderRadius: AVATAR / 2,
            borderWidth: 2.5,
            backgroundColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center',
            justifyContent: 'center',
        },
        slotEmptyDashed: {
            borderStyle: 'dashed',
        },
        panelEmpty: {
            width: AVATAR,
            height: AVATAR,
            borderRadius: AVATAR / 2,
            borderWidth: 2.5,
            backgroundColor: c.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
        },
        slotName: {
            marginTop: 3,
            fontSize: 11,
            fontWeight: '700',
            color: '#FFF',
            textShadowColor: 'rgba(0,0,0,0.55)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 2,
            maxWidth: AVATAR + 12,
            textAlign: 'center',
        },
        captainBadge: {
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: '#F59E0B',
            borderWidth: 1.5,
            borderColor: '#FFF',
            alignItems: 'center',
            justifyContent: 'center',
        },
        captainBadgeText: {
            color: '#111',
            fontWeight: '900',
            fontSize: 11,
        },
        panelCard: {
            backgroundColor: c.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: c.border,
            padding: 12,
            gap: 10,
        },
        panelHead: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        panelAccent: {
            width: 4,
            height: 16,
            borderRadius: 2,
            backgroundColor: '#16A34A',
        },
        panelTitle: {
            flex: 1,
            fontSize: 14,
            fontWeight: '800',
            color: c.text,
        },
        panelMeta: { fontSize: 12, fontWeight: '700', color: '#94A3B8' },
        ultrasInlineHead: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 2,
        },
        ultrasInlineTitle: {
            flex: 1,
            fontSize: 12,
            fontWeight: '800',
            color: '#EF4444',
        },
        benchRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'flex-start',
        },
        benchRowSingle: {
            flexDirection: 'row',
            flexWrap: 'nowrap',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 4,
        },
        benchFlexCell: { flex: 1, alignItems: 'center' },
        aficionGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: 10,
            columnGap: 0,
        },
        aficionCell: {
            width: '20%',
            alignItems: 'center',
            paddingHorizontal: 2,
        },
        benchSlot: { width: AVATAR + 8, alignItems: 'center', gap: 3 },
        benchSlotCompact: { alignItems: 'center', gap: 2 },
        benchSlotCenter: { alignSelf: 'center' },
        benchName: {
            fontSize: 11,
            color: c.textMuted,
            fontWeight: '700',
            textAlign: 'center',
            maxWidth: AVATAR + 8,
        },
        leaveBtn: { alignSelf: 'center', paddingVertical: 6 },
        leaveText: { color: '#DC2626', fontWeight: '700', fontSize: 13 },
        hint: { fontSize: 12, color: c.textMuted, textAlign: 'center' },
        colorRow: {
            flexDirection: 'row',
            gap: 10,
            alignItems: 'center',
            paddingVertical: 4,
            paddingHorizontal: 4,
        },
        colorDot: { width: 26, height: 26, borderRadius: 13 },
        colorDotOn: { borderWidth: 2.5, borderColor: '#2563EB' },
        dotLight: { borderWidth: 1, borderColor: '#CBD5E1' },
        leagueWrap: { gap: 14 },
        leagueHint: { fontSize: 13, color: c.textMuted, fontWeight: '600', marginTop: 2 },
        renameBlock: { gap: 8 },
        leagueRenameTitle: { fontSize: 15, fontWeight: '800', color: c.text },
        renameInput: {
            backgroundColor: c.surfaceSubtle,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontWeight: '700',
            fontSize: 15,
            color: c.text,
        },
        leagueCard: {
            backgroundColor: c.surface,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: c.border,
            overflow: 'hidden',
            shadowColor: '#0F172A',
            shadowOpacity: 0.1,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 3,
        },
        leagueCardTop: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 12,
            backgroundColor: c.surfaceSubtle,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: c.border,
        },
        leagueCardTopIcon: {
            width: 40,
            height: 40,
            borderRadius: 14,
            backgroundColor: '#FEF3C7',
            alignItems: 'center',
            justifyContent: 'center',
        },
        leagueCardTitle: {
            fontSize: 18,
            fontWeight: '900',
            color: c.text,
            letterSpacing: -0.3,
        },
        leagueHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: 10,
            paddingRight: 10,
            paddingVertical: 12,
            backgroundColor: '#0F172A',
            gap: 4,
        },
        leagueTh: {
            color: '#94A3B8',
            fontSize: 12,
            fontWeight: '800',
            textAlign: 'center',
            letterSpacing: 0.3,
        },
        leagueRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: 0,
            paddingRight: 10,
            paddingVertical: 14,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            backgroundColor: c.surface,
            minHeight: 56,
            gap: 4,
        },
        leagueRowAlt: {
            backgroundColor: c.surfaceSubtle,
        },
        leagueRowLead: {
            backgroundColor: '#FFFBEB',
        },
        leagueAccent: {
            width: 5,
            alignSelf: 'stretch',
            marginRight: 8,
        },
        leagueAccentSpacer: {
            width: 5,
            marginRight: 8,
        },
        leagueAccentLight: {
            borderRightWidth: 1,
            borderRightColor: '#CBD5E1',
        },
        rankBadge: {
            width: 28,
            height: 28,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.surfaceSubtle,
            marginRight: 4,
        },
        rankGold: { backgroundColor: '#F59E0B' },
        rankSilver: { backgroundColor: '#94A3B8' },
        rankBronze: { backgroundColor: '#D97706' },
        rankBadgeText: {
            fontSize: 13,
            fontWeight: '900',
            color: c.textMuted,
        },
        rankBadgeTextOn: { color: '#FFF' },
        leagueTd: {
            color: c.text,
            fontSize: 15,
            fontWeight: '700',
            textAlign: 'center',
        },
        leaguePts: { color: '#2563EB', fontWeight: '900', fontSize: 16 },
        colPos: { width: 32 },
        colTeam: { flex: 1, paddingHorizontal: 6, minWidth: 0 },
        colStat: { width: 40, marginHorizontal: 1 },
        teamCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        leagueTeamName: {
            flex: 1,
            fontSize: 15,
            fontWeight: '800',
            color: c.text,
        },
        statInput: {
            width: 40,
            marginHorizontal: 1,
            textAlign: 'center',
            fontSize: 15,
            fontWeight: '800',
            color: c.text,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 10,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: c.border,
        },
        statInputPts: {
            color: '#2563EB',
            fontWeight: '900',
            borderColor: '#93C5FD',
            backgroundColor: '#EFF6FF',
        },
        pickBackdrop: {
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            justifyContent: 'center',
            padding: 20,
        },
        pickCard: {
            backgroundColor: c.surface,
            borderRadius: 24,
            paddingTop: 16,
            paddingHorizontal: 14,
            paddingBottom: 14,
            gap: 12,
            maxHeight: '82%',
            shadowColor: '#0F172A',
            shadowOpacity: 0.2,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 10,
        },
        pickHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 4,
        },
        pickHeaderIcon: {
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: '#2563EB',
            alignItems: 'center',
            justifyContent: 'center',
        },
        pickHeaderText: { flex: 1, gap: 2 },
        pickClose: {
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: c.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
        },
        pickTitle: { fontSize: 18, fontWeight: '900', color: c.text },
        pickSub: { fontSize: 13, color: c.textMuted, fontWeight: '600', lineHeight: 18 },
        pickScroll: { maxHeight: 420 },
        pickScrollContent: { gap: 10, paddingBottom: 4 },
        pickTeamCard: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: c.border,
            paddingVertical: 12,
            paddingRight: 10,
            overflow: 'hidden',
        },
        pickTeamStripe: { width: 5, alignSelf: 'stretch', borderRadius: 0 },
        pickTeamBody: { flex: 1, gap: 8 },
        pickTeamTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        pickTeamBadge: {
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
        },
        pickTeamBadgeText: { color: '#FFF', fontWeight: '900', fontSize: 13 },
        pickName: { flex: 1, fontWeight: '800', color: c.text, fontSize: 15 },
        pickCountPill: {
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: '#E2E8F0',
        },
        pickCountPillOk: { backgroundColor: '#DCFCE7' },
        pickCountPillFull: { backgroundColor: '#FEE2E2' },
        pickCountPillText: { fontWeight: '800', color: '#475569', fontSize: 11 },
        pickCountPillTextFull: { color: '#B91C1C' },
        pickProgressTrack: {
            height: 4,
            borderRadius: 2,
            backgroundColor: c.border,
            overflow: 'hidden',
        },
        pickProgressFill: { height: '100%', borderRadius: 2 },
        pickFansCard: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: '#F0F9FF',
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: '#BAE6FD',
            paddingVertical: 12,
            paddingHorizontal: 12,
            marginTop: 2,
        },
        pickFansIcon: {
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: '#E0F2FE',
            alignItems: 'center',
            justifyContent: 'center',
        },
        pickRowDisabled: { opacity: 0.42 },
    });
}
