import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import { hapticError, hapticLight, hapticSuccess } from '../lib/haptics';
import {
    fetchChampionPoll,
    percentForTeam,
    voteChampionPoll,
    type ChampionPollSnapshot,
} from '../lib/tournamentChampionPoll';
import type { TournamentConfig } from '../lib/footballTournament';

function isLightColor(color: string) {
    const c = color.trim().toUpperCase();
    return c === '#FFF' || c === '#FFFFFF' || c === '#F8FAFC' || c === '#F1F5F9';
}

type Props = {
    planId: string;
    config: TournamentConfig;
    currentUserId: string | null;
    canVote?: boolean;
    requireAccount?: () => boolean;
};

export function TournamentChampionPoll({
    planId,
    config,
    currentUserId,
    canVote = true,
    requireAccount,
}: Props) {
    const { t } = useT();
    const styles = useThemedStyles(createStyles);
    const [snap, setSnap] = useState<ChampionPollSnapshot>({
        myVote: null,
        total: 0,
        totals: [],
    });
    const [busy, setBusy] = useState(false);
    const revealed = snap.myVote != null || snap.total > 0;

    useEffect(() => {
        let cancelled = false;
        void fetchChampionPoll(planId).then((next) => {
            if (!cancelled) setSnap(next);
        });
        return () => {
            cancelled = true;
        };
    }, [planId]);

    const onVote = useCallback(
        async (equipo: number) => {
            if (!canVote || busy) {
                hapticLight();
                return;
            }
            if (!currentUserId) {
                if (requireAccount?.()) return;
                hapticLight();
                return;
            }
            const prev = snap;
            setBusy(true);
            // Optimista: marcar voto y repartir % aproximado.
            const withoutMe = prev.totals
                .map((row) =>
                    row.equipo === prev.myVote
                        ? { ...row, votos: Math.max(0, row.votos - 1) }
                        : row,
                )
                .filter((row) => row.votos > 0);
            const existing = withoutMe.find((r) => r.equipo === equipo);
            const nextTotals = existing
                ? withoutMe.map((r) =>
                      r.equipo === equipo ? { ...r, votos: r.votos + 1 } : r,
                  )
                : [...withoutMe, { equipo, votos: 1 }];
            const nextTotal =
                prev.myVote == null ? prev.total + 1 : Math.max(1, prev.total);
            setSnap({ myVote: equipo, total: nextTotal, totals: nextTotals });
            hapticSuccess();
            try {
                const server = await voteChampionPoll(planId, equipo);
                setSnap(server);
            } catch {
                setSnap(prev);
                hapticError();
            } finally {
                setBusy(false);
            }
        },
        [busy, canVote, currentUserId, planId, requireAccount, snap],
    );

    return (
        <View style={styles.card}>
            <View style={styles.head}>
                <View style={styles.headIcon}>
                    <Ionicons name="trophy" size={16} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{t('torneo.pollTitle')}</Text>
                    <Text style={styles.sub}>
                        {snap.myVote != null
                            ? t('torneo.pollVotedSub', { n: snap.total })
                            : t('torneo.pollSub')}
                    </Text>
                </View>
            </View>
            <View style={styles.list}>
                {config.equipos.map((tm, equipo) => {
                    const pct = revealed ? percentForTeam(snap, equipo) : 0;
                    const selected = snap.myVote === equipo;
                    const color = tm.color ?? '#94A3B8';
                    return (
                        <TouchableOpacity
                            key={equipo}
                            style={[styles.row, selected && styles.rowOn]}
                            activeOpacity={0.88}
                            disabled={!canVote || busy}
                            onPress={() => void onVote(equipo)}
                        >
                            <View
                                style={[
                                    styles.dot,
                                    { backgroundColor: color },
                                    isLightColor(color) && styles.dotLight,
                                ]}
                            />
                            <Text style={styles.name} numberOfLines={1}>
                                {tm.nombre}
                            </Text>
                            {snap.myVote != null ? (
                                <View style={styles.pctWrap}>
                                    <View style={styles.pctTrack}>
                                        <View
                                            style={[
                                                styles.pctFill,
                                                {
                                                    width: `${pct}%`,
                                                    backgroundColor: selected ? '#2563EB' : '#94A3B8',
                                                },
                                            ]}
                                        />
                                    </View>
                                    <Text style={[styles.pctText, selected && styles.pctTextOn]}>
                                        {pct}%
                                    </Text>
                                </View>
                            ) : (
                                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>
            {snap.myVote == null && canVote && currentUserId ? (
                <Text style={styles.hint}>{t('torneo.pollHint')}</Text>
            ) : null}
            {canVote && !currentUserId ? (
                <TouchableOpacity onPress={() => requireAccount?.()} activeOpacity={0.85}>
                    <Text style={[styles.hint, styles.hintLink]}>{t('torneo.pollGuestHint')}</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
        card: {
            backgroundColor: c.surface,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: c.border,
            padding: 14,
            gap: 12,
        },
        head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        headIcon: {
            width: 34,
            height: 34,
            borderRadius: 11,
            backgroundColor: '#CA8A04',
            alignItems: 'center',
            justifyContent: 'center',
        },
        title: { fontSize: 15, fontWeight: '900', color: c.text },
        sub: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginTop: 1 },
        list: { gap: 8 },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 10,
            paddingHorizontal: 10,
            borderRadius: 14,
            backgroundColor: c.surfaceSubtle,
            borderWidth: 1,
            borderColor: c.border,
        },
        rowOn: {
            borderColor: '#2563EB',
            backgroundColor: '#EFF6FF',
        },
        dot: { width: 12, height: 12, borderRadius: 6 },
        dotLight: { borderWidth: 1, borderColor: '#CBD5E1' },
        name: { flex: 1, fontWeight: '800', color: c.text, fontSize: 14 },
        pctWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 88 },
        pctTrack: {
            flex: 1,
            height: 6,
            borderRadius: 3,
            backgroundColor: c.border,
            overflow: 'hidden',
        },
        pctFill: { height: '100%', borderRadius: 3 },
        pctText: { width: 36, textAlign: 'right', fontWeight: '800', color: '#64748B', fontSize: 12 },
        pctTextOn: { color: '#1D4ED8' },
        hint: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
        hintLink: { color: '#2563EB', fontWeight: '800' },
    });
}
