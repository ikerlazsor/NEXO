import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../lib/i18n';
import { getAspectLabel } from '../lib/ratings';
import { hasPublicReputationStats, type UserStats } from '../lib/stats';

const INK = '#0F2A4A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const SUCCESS = '#059669';
const DANGER = '#DC2626';
const PRIMARY_DARK = '#2563EB';
const AMBER = '#B45309';

type Props = {
    stats: UserStats;
    displayName?: string | null;
    isSelf?: boolean;
    genero?: string | null;
};

function lowerFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}

export function ProfileReputationStats({ stats, displayName, isSelf = false, genero }: Props) {
    const { t } = useT();

    if (!hasPublicReputationStats(stats)) return null;

    const repeatPct = Math.round(stats.porcentajeRepetiria);
    const name = (displayName || '').trim() || t('profile.user');
    const kicks = stats.numeroExpulsiones ?? 0;

    const posLabel = stats.aspectoPositivoMasVotado
        ? lowerFirst(getAspectLabel('pos', stats.aspectoPositivoMasVotado, genero, t))
        : null;
    const negLabel = stats.aspectoNegativoMasVotado
        ? lowerFirst(getAspectLabel('neg', stats.aspectoNegativoMasVotado, genero, t))
        : null;

    const repeatLine = isSelf
        ? t('profile.rep.repeatSelf', { pct: repeatPct })
        : t('profile.rep.repeatOther', { pct: repeatPct, name });

    const posLine = posLabel
        ? isSelf
            ? t('profile.rep.highlightSelf', { trait: posLabel })
            : t('profile.rep.highlightOther', { name, trait: posLabel })
        : null;

    const negLine = negLabel
        ? isSelf
            ? t('profile.rep.improveSelf', { trait: negLabel })
            : t('profile.rep.improveOther', { name, trait: negLabel })
        : null;

    const kickLine =
        kicks > 0
            ? kicks === 1
                ? isSelf
                    ? t('profile.rep.kickedSelfOne')
                    : t('profile.rep.kickedOtherOne', { name })
                : isSelf
                  ? t('profile.rep.kickedSelfMany', { n: kicks })
                  : t('profile.rep.kickedOtherMany', { name, n: kicks })
            : null;

    return (
        <View style={styles.wrap}>
            <View style={styles.card}>
                <View style={styles.line}>
                    <View style={[styles.iconBubble, styles.iconBlue]}>
                        <Ionicons name="heart" size={14} color={PRIMARY_DARK} />
                    </View>
                    <Text style={styles.lineText}>{repeatLine}</Text>
                </View>

                {posLine ? (
                    <View style={styles.line}>
                        <View style={[styles.iconBubble, styles.iconGreen]}>
                            <Ionicons name="star" size={14} color={SUCCESS} />
                        </View>
                        <Text style={styles.lineText}>{posLine}</Text>
                    </View>
                ) : null}

                {negLine ? (
                    <View style={styles.line}>
                        <View style={[styles.iconBubble, styles.iconAmber]}>
                            <Ionicons name="leaf-outline" size={14} color={AMBER} />
                        </View>
                        <Text style={styles.lineText}>{negLine}</Text>
                    </View>
                ) : null}

                {kickLine ? (
                    <View style={styles.line}>
                        <View style={[styles.iconBubble, styles.iconRed]}>
                            <Ionicons name="exit-outline" size={14} color={DANGER} />
                        </View>
                        <Text style={[styles.lineText, styles.kickText]}>{kickLine}</Text>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        width: '100%',
        marginTop: 16,
    },
    card: {
        width: '100%',
        backgroundColor: '#F8FBFF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E0EFFF',
        paddingVertical: 12,
        paddingHorizontal: 12,
        gap: 11,
    },
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconBubble: {
        width: 28,
        height: 28,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconBlue: { backgroundColor: '#DBEAFE' },
    iconGreen: { backgroundColor: '#D1FAE5' },
    iconAmber: { backgroundColor: '#FEF3C7' },
    iconRed: { backgroundColor: '#FEE2E2' },
    lineText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: INK,
        lineHeight: 18,
        paddingTop: 2,
    },
    kickText: {
        color: MUTED,
    },
});
