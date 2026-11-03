import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import { hapticError, hapticLight, hapticSuccess } from '../lib/haptics';
import { Alert } from '../lib/nexoAlert';
import { presentInAppToast } from '../lib/inAppToast';
import {
    aficionTeamIndex,
    claimTournamentSlot,
    fansCapacity,
    fansFilledCount,
    firstFreeFansSlot,
    firstFreeSlot,
    isFansTeam,
    teamRegistrationStats,
    type TournamentConfig,
    type TournamentOccupant,
} from '../lib/footballTournament';
import {
    loadTournamentLineup,
    peekTournamentLineup,
    seedTournamentLineup,
} from '../lib/tournamentLineupCache';

function isLightColor(color: string) {
    const c = color.trim().toUpperCase();
    return c === '#FFF' || c === '#FFFFFF' || c === '#F8FAFC' || c === '#F1F5F9';
}

function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
}

type Props = {
    planId: string;
    currentUserId: string | null;
    preferredTeam?: number | null;
    enabled?: boolean;
    ensureJoined?: () => Promise<boolean>;
    requireAccount?: () => boolean;
    onActiveChange?: (active: boolean) => void;
    onSettled?: () => void;
};

/**
 * Picker de clase lo antes posible (encima del skeleton), sin esperar al detalle del plan.
 */
export function TournamentEarlyPick({
    planId,
    currentUserId,
    preferredTeam = null,
    enabled = true,
    ensureJoined,
    requireAccount,
    onActiveChange,
    onSettled,
}: Props) {
    const { t } = useT();
    const styles = useThemedStyles(createStyles);
    const warm = peekTournamentLineup(planId);
    const [config, setConfig] = useState<TournamentConfig | null>(() => warm?.config ?? null);
    const [slots, setSlots] = useState<TournamentOccupant[]>(() => warm?.slots ?? []);
    const [open, setOpen] = useState(() => {
        if (!enabled || !warm?.config) return false;
        if (
            currentUserId &&
            warm.slots.some((s) => String(s.usuario_id) === String(currentUserId))
        ) {
            return false;
        }
        return true;
    });
    const [loadingTeams, setLoadingTeams] = useState(() => !warm?.config);
    const dismissedRef = useRef(false);
    const claimInFlight = useRef(false);
    const openedOnceRef = useRef(open);

    useEffect(() => {
        dismissedRef.current = false;
        const peek = peekTournamentLineup(planId);
        setConfig(peek?.config ?? null);
        setSlots(peek?.slots ?? []);
        setLoadingTeams(!peek?.config);
        openedOnceRef.current = false;
        if (peek?.config && enabled) {
            const seated =
                !!currentUserId &&
                peek.slots.some((s) => String(s.usuario_id) === String(currentUserId));
            if (!seated) {
                openedOnceRef.current = true;
                setOpen(true);
                onActiveChange?.(true);
            } else {
                setOpen(false);
                onActiveChange?.(false);
            }
        } else {
            setOpen(false);
            onActiveChange?.(false);
        }
        let cancelled = false;
        void loadTournamentLineup(planId, { force: true })
            .then((snap) => {
                if (cancelled) return;
                setConfig(snap.config);
                if (!claimInFlight.current) {
                    setSlots(snap.slots);
                }
                setLoadingTeams(false);
                if (!snap.config) {
                    setOpen(false);
                    onActiveChange?.(false);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setLoadingTeams(false);
                setOpen(false);
                onActiveChange?.(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, onActiveChange, planId]);

    useEffect(() => {
        if (!enabled || dismissedRef.current) {
            setOpen(false);
            onActiveChange?.(false);
            return;
        }
        if (!config) return;
        if (currentUserId) {
            const mine = slots.find((s) => String(s.usuario_id) === String(currentUserId));
            if (mine) {
                setOpen(false);
                onActiveChange?.(false);
                return;
            }
        }
        if (!openedOnceRef.current) {
            openedOnceRef.current = true;
            if (
                preferredTeam != null &&
                preferredTeam >= 0 &&
                preferredTeam < config.equipos.length
            ) {
                /* highlight futuro */
            }
            setOpen(true);
            onActiveChange?.(true);
        }
    }, [config, currentUserId, enabled, onActiveChange, preferredTeam, slots]);

    const teamStats = useMemo(
        () =>
            config
                ? teamRegistrationStats(config, slots).filter((s) => !s.aficion && !s.ultras)
                : [],
        [config, slots],
    );
    const afIdx = config ? aficionTeamIndex(config) : -1;

    const close = useCallback(() => {
        dismissedRef.current = true;
        setOpen(false);
        onActiveChange?.(false);
        onSettled?.();
    }, [onActiveChange, onSettled]);

    const claimIntoTeam = useCallback(
        (equipo: number) => {
            if (!config) return;
            // Cerrar modal ANTES de AuthPrompt (evita 2 Modales → crash iOS).
            setOpen(false);
            onActiveChange?.(false);
            if (requireAccount?.()) {
                onSettled?.();
                return;
            }
            if (!currentUserId) {
                onSettled?.();
                return;
            }
            if (claimInFlight.current) {
                hapticLight();
                return;
            }
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
                onSettled?.();
                return;
            }
            const snapshot = slots;
            const configSnapshot = config;
            const teamName =
                isFansTeam(config, target.equipo)
                    ? t('torneo.fans')
                    : (config.equipos[target.equipo]?.nombre ?? t('torneo.tabSquads'));
            claimInFlight.current = true;
            setSlots((prev) => {
                const next = [
                    ...prev.filter((s) => String(s.usuario_id) !== String(currentUserId)),
                    {
                        equipo: target.equipo,
                        posicion: target.posicion,
                        usuario_id: currentUserId,
                    },
                ];
                seedTournamentLineup(planId, config, next);
                return next;
            });
            onSettled?.();
            hapticSuccess();
            presentInAppToast({
                id: `torneo-join:${planId}`,
                title: t('torneo.joinedToast', { team: teamName }),
                body: t('torneo.joinedToastBody'),
            });
            void (async () => {
                try {
                    if (ensureJoined) {
                        const ok = await ensureJoined();
                        if (!ok) {
                            // ensureJoined ya muestra Alert; no reabrir picker (pending/waitlist).
                            setSlots(snapshot);
                            seedTournamentLineup(planId, configSnapshot, snapshot);
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
                        seedTournamentLineup(planId, configSnapshot, snapshot);
                        hapticError();
                        await sleep(80);
                        Alert.alert(
                            t('feed.error'),
                            /unique|duplicate|slot|ocupad|taken/i.test(error)
                                ? t('futbol.slotTaken')
                                : t('feed.joinError'),
                        );
                    }
                } finally {
                    claimInFlight.current = false;
                }
            })();
        },
        [
            config,
            currentUserId,
            ensureJoined,
            onActiveChange,
            onSettled,
            planId,
            requireAccount,
            slots,
            t,
        ],
    );

    if (!enabled) return null;

    return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
            <View style={styles.pickBackdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={close} />
                <View style={styles.pickCard}>
                    <View style={styles.pickHeader}>
                        <View style={styles.pickHeaderIcon}>
                            <Ionicons name="shirt-outline" size={22} color="#FFF" />
                        </View>
                        <View style={styles.pickHeaderText}>
                            <Text style={styles.pickTitle}>{t('torneo.chooseClassTitle')}</Text>
                            <Text style={styles.pickSub}>{t('torneo.chooseClassSub')}</Text>
                        </View>
                        <TouchableOpacity onPress={close} hitSlop={10} style={styles.pickClose}>
                            <Ionicons name="close" size={20} color="#94A3B8" />
                        </TouchableOpacity>
                    </View>
                    {!config || loadingTeams ? (
                        <View style={styles.loadingBox}>
                            <ActivityIndicator color="#2563EB" />
                            <Text style={styles.loadingText}>{t('common.loading')}</Text>
                        </View>
                    ) : (
                        <ScrollView
                            style={styles.pickScroll}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.pickScrollContent}
                        >
                            {teamStats.map((s) => {
                                const tm = config.equipos[s.equipo];
                                const full = s.filled >= s.capacity;
                                const pct =
                                    s.capacity > 0 ? Math.min(1, s.filled / s.capacity) : 0;
                                const color = tm?.color ?? '#94A3B8';
                                return (
                                    <TouchableOpacity
                                        key={s.equipo}
                                        style={[styles.pickTeamCard, full && styles.pickRowDisabled]}
                                        disabled={full}
                                        onPress={() => claimIntoTeam(s.equipo)}
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
                            {afIdx >= 0
                                ? (() => {
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
                                              onPress={() => claimIntoTeam(afIdx)}
                                              activeOpacity={0.88}
                                          >
                                              <View style={styles.pickFansIcon}>
                                                  <Ionicons
                                                      name="people"
                                                      size={20}
                                                      color="#0EA5E9"
                                                  />
                                              </View>
                                              <View style={styles.pickTeamBody}>
                                                  <View style={styles.pickTeamTop}>
                                                      <Text style={styles.pickName}>
                                                          {t('torneo.fans')}
                                                      </Text>
                                                      <View
                                                          style={[
                                                              styles.pickCountPill,
                                                              full && styles.pickCountPillFull,
                                                          ]}
                                                      >
                                                          <Text
                                                              style={[
                                                                  styles.pickCountPillText,
                                                                  full &&
                                                                      styles.pickCountPillTextFull,
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
                                  })()
                                : null}
                        </ScrollView>
                    )}
                </View>
            </View>
        </Modal>
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
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
        loadingBox: {
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            paddingVertical: 36,
        },
        loadingText: { fontWeight: '700', color: c.textMuted, fontSize: 14 },
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
        dotLight: { borderWidth: 1, borderColor: '#CBD5E1' },
    });
}
