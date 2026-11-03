import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { ProfileAvatar } from './ProfileAvatar';
import { useT } from '../lib/i18n';
import {
    fullestTeamIndex,
    startersCount,
    teamStarterSlots,
    type TournamentConfig,
    type TournamentOccupant,
} from '../lib/footballTournament';
import { planShareUrl } from '../lib/shareLinks';
import {
    cacheRemoteImageForShare,
    captureTournamentPitchImage,
    setTournamentShareExternalListener,
    shareCapturedTournamentPitch,
    waitForShareAvatars,
} from '../lib/shareTournamentPitch';
import { loadTournamentLineup } from '../lib/tournamentLineupCache';
import { supabase } from '../lib/supabase';

type Person = { id: string; nombre: string; avatar_url?: string | null };

const AVATAR = 56;
const SLOT_H = 82;

function shortName(nombre?: string | null) {
    const raw = (nombre ?? '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] ?? raw;
}

function isLightColor(color: string) {
    const c = color.trim().toUpperCase();
    return c === '#FFF' || c === '#FFFFFF';
}

/**
 * Host global: captura campo+banquillo al compartir desde la tarjeta del feed.
 */
export function TournamentShareHost() {
    const { t } = useT();
    const [planId, setPlanId] = useState<string | null>(null);
    const [config, setConfig] = useState<TournamentConfig | null>(null);
    const [slots, setSlots] = useState<TournamentOccupant[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [teamIndex, setTeamIndex] = useState(0);
    const [ready, setReady] = useState(false);
    const [layoutReady, setLayoutReady] = useState(false);
    const pitchRef = useRef<View>(null);
    const ranRef = useRef(false);

    useEffect(() => {
        setTournamentShareExternalListener((req) => {
            ranRef.current = false;
            setReady(false);
            setLayoutReady(false);
            setConfig(null);
            setSlots([]);
            setPeople([]);
            setPlanId(req.planId);
        });
        return () => setTournamentShareExternalListener(null);
    }, []);

    useEffect(() => {
        if (!planId) return;
        let cancelled = false;
        void (async () => {
            const snap = await loadTournamentLineup(planId);
            if (cancelled) return;
            if (!snap.config) {
                setPlanId(null);
                return;
            }
            const cfg = snap.config;
            const nextSlots = snap.slots;
            const fullest = fullestTeamIndex(cfg, nextSlots);
            const userIds = [...new Set(nextSlots.map((s) => s.usuario_id))];
            let peopleRows: Person[] = [];
            if (userIds.length) {
                const { data } = await supabase
                    .from('perfiles')
                    .select('id, nombre, avatar_url')
                    .in('id', userIds);
                peopleRows = (data ?? []).map((p) => ({
                    id: String((p as { id: string }).id),
                    nombre: String((p as { nombre?: string }).nombre ?? ''),
                    avatar_url: (p as { avatar_url?: string | null }).avatar_url ?? null,
                }));
            }
            // file:// para view-shot (remoto + expo-image sale gris).
            const withLocal = await Promise.all(
                peopleRows.map(async (p) => {
                    const local = await cacheRemoteImageForShare(p.avatar_url);
                    return local ? { ...p, avatar_url: local } : p;
                }),
            );
            await waitForShareAvatars(withLocal.map((p) => p.avatar_url));
            if (cancelled) return;
            setConfig(cfg);
            setSlots(nextSlots);
            setPeople(withLocal);
            setTeamIndex(fullest);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [planId]);

    useEffect(() => {
        if (!planId || !ready || !config || !layoutReady || ranRef.current) return;
        ranRef.current = true;
        void (async () => {
            const imageUri = await captureTournamentPitchImage(pitchRef);
            const id = planId;
            // Quitar el host ANTES de abrir WhatsApp: si no, tapa el feed en negro.
            setPlanId(null);
            setReady(false);
            setLayoutReady(false);
            setConfig(null);
            setPeople([]);
            await new Promise<void>((r) => setTimeout(r, 32));
            await shareCapturedTournamentPitch({
                planId: id,
                message: t('torneo.shareAllMsg'),
                imageUri,
                teamUrl: planShareUrl(id),
            });
        })();
    }, [config, layoutReady, planId, ready, t]);

    const peopleById = useMemo(
        () => new Map(people.map((p) => [String(p.id), p])),
        [people],
    );
    const team = config?.equipos[teamIndex];
    const starters = config ? startersCount(config) : 0;
    const pitchSlots = config ? teamStarterSlots(config) : [];
    const teamColor = team?.color ?? '#FFFFFF';
    const captainId =
        team?.capitan_id ??
        slots
            .filter((s) => s.equipo === teamIndex)
            .sort((a, b) => a.posicion - b.posicion)[0]?.usuario_id ??
        null;

    if (!planId || !config) return null;

    return (
        <Modal visible transparent animationType="none" onRequestClose={() => setPlanId(null)}>
            <View style={styles.host} pointerEvents="none">
                <View ref={pitchRef} collapsable={false} style={styles.card}>
                    <View style={styles.letterbox} />
                    <CapturePitch
                        pitchSlots={pitchSlots}
                        starters={starters}
                        teamIndex={teamIndex}
                        teamColor={teamColor}
                        captainId={captainId}
                        slots={slots}
                        peopleById={peopleById}
                        onReady={() => setLayoutReady(true)}
                    />
                    <View style={styles.letterbox} />
                </View>
            </View>
        </Modal>
    );
}

function CapturePitch({
    pitchSlots,
    starters,
    teamIndex,
    teamColor,
    captainId,
    slots,
    peopleById,
    onReady,
}: {
    pitchSlots: { x: number; y: number }[];
    starters: number;
    teamIndex: number;
    teamColor: string;
    captainId: string | null;
    slots: TournamentOccupant[];
    peopleById: Map<string, Person>;
    onReady?: () => void;
}) {
    const [size, setSize] = useState({ w: 0, h: 0 });
    const border = isLightColor(teamColor) ? '#E2E8F0' : teamColor;
    return (
        <View
            style={styles.pitch}
            onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                const h = Math.round(e.nativeEvent.layout.height);
                if (w > 0 && h > 0 && (w !== size.w || h !== size.h)) {
                    setSize({ w, h });
                    onReady?.();
                }
            }}
        >
            {size.h > 0
                ? Array.from({ length: 8 }, (_, i) => (
                      <View
                          key={i}
                          style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: (size.h * i) / 8,
                              height: size.h / 8,
                              backgroundColor: i % 2 === 0 ? '#166534' : '#15803D',
                          }}
                      />
                  ))
                : null}
            <View style={styles.pitchBorder} />
            {size.w > 0 ? (
                <View
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
            {size.w > 0 ? (
                <>
                    <View
                        style={[
                            styles.goalArea,
                            {
                                left: size.w * 0.18,
                                width: size.w * 0.64,
                                height: size.h * 0.2,
                            },
                        ]}
                    />
                    <View
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
                        style={[
                            styles.goalSmallArea,
                            {
                                left: size.w * 0.32,
                                width: size.w * 0.36,
                                height: size.h * 0.09,
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
                      const yFromTop = 1 - slot.y / 0.48;
                      let ySpread = 0.08 + yFromTop * 0.72;
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
                          <View key={posicion} style={[styles.slot, { left, top }]}>
                              {occ ? (
                                  <View style={[styles.ring, { borderColor: border }]}>
                                      <ProfileAvatar
                                          uri={person?.avatar_url}
                                          name={person?.nombre || '?'}
                                          size={AVATAR - 6}
                                          recyclingKey={occ.usuario_id}
                                          snapshotFriendly
                                      />
                                  </View>
                              ) : (
                                  <View style={[styles.empty, { borderColor: border }]} />
                              )}
                              {isCap ? (
                                  <View style={styles.cap}>
                                      <Text style={styles.capText}>C</Text>
                                  </View>
                              ) : null}
                              {occ ? (
                                  <Text style={styles.slotName} numberOfLines={1}>
                                      {shortName(person?.nombre)}
                                  </Text>
                              ) : null}
                          </View>
                      );
                  })
                : null}
        </View>
    );
}

const styles = StyleSheet.create({
    host: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingTop: 8,
        paddingHorizontal: 12,
    },
    card: {
        backgroundColor: '#0B1220',
        borderRadius: 18,
        paddingHorizontal: 8,
        width: '100%',
        maxWidth: 360,
        overflow: 'hidden',
    },
    letterbox: {
        height: 16,
        backgroundColor: '#0B1220',
    },
    pitch: {
        height: 400,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#15803D',
    },
    pitchBorder: {
        ...StyleSheet.absoluteFillObject,
        borderWidth: 2.5,
        borderColor: 'rgba(255,255,255,0.85)',
        borderRadius: 16,
    },
    centerArc: {
        position: 'absolute',
        top: 0,
        borderWidth: 2.5,
        borderTopWidth: 0,
        borderColor: 'rgba(255,255,255,0.95)',
        borderBottomLeftRadius: 999,
        borderBottomRightRadius: 999,
    },
    goalArea: {
        position: 'absolute',
        bottom: 0,
        borderWidth: 2.5,
        borderBottomWidth: 0,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    goalSmallArea: {
        position: 'absolute',
        bottom: 0,
        borderWidth: 2.5,
        borderBottomWidth: 0,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    penaltyArc: {
        position: 'absolute',
        borderWidth: 2.5,
        borderBottomWidth: 0,
        borderColor: 'rgba(255,255,255,0.95)',
        borderTopLeftRadius: 999,
        borderTopRightRadius: 999,
    },
    slot: {
        position: 'absolute',
        width: AVATAR + 8,
        height: SLOT_H,
        alignItems: 'center',
    },
    ring: {
        width: AVATAR,
        height: AVATAR,
        borderRadius: AVATAR / 2,
        borderWidth: 3,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    empty: {
        width: AVATAR,
        height: AVATAR,
        borderRadius: AVATAR / 2,
        borderWidth: 2.5,
        backgroundColor: 'rgba(255,255,255,0.18)',
    },
    slotName: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: '700',
        color: '#FFF',
        textAlign: 'center',
    },
    cap: {
        position: 'absolute',
        right: 0,
        top: AVATAR - 18,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#F59E0B',
        alignItems: 'center',
        justifyContent: 'center',
    },
    capText: { fontSize: 10, fontWeight: '900', color: '#111' },
});
