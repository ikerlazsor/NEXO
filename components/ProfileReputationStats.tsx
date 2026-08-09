import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../lib/i18n';
import { getAspectLabel } from '../lib/ratings';
import { hasPublicReputationStats, type UserStats } from '../lib/stats';

const INK = '#0F2A4A';
const MUTED = '#64748B';
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

type Insight = {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
    tone: 'blue' | 'green' | 'amber' | 'red';
};

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

    const insights: Insight[] = [
        {
            key: 'repeat',
            icon: 'heart',
            tone: 'blue',
            text: isSelf
                ? t('profile.rep.repeatSelf', { pct: repeatPct })
                : t('profile.rep.repeatOther', { pct: repeatPct, name }),
        },
    ];

    if (posLabel) {
        insights.push({
            key: 'pos',
            icon: 'star',
            tone: 'green',
            text: isSelf
                ? t('profile.rep.highlightSelf', { trait: posLabel })
                : t('profile.rep.highlightOther', { name, trait: posLabel }),
        });
    }

    if (negLabel) {
        insights.push({
            key: 'neg',
            icon: 'leaf-outline',
            tone: 'amber',
            text: isSelf
                ? t('profile.rep.improveSelf', { trait: negLabel })
                : t('profile.rep.improveOther', { name, trait: negLabel }),
        });
    }

    if (kicks > 0) {
        insights.push({
            key: 'kick',
            icon: 'exit-outline',
            tone: 'red',
            text:
                kicks === 1
                    ? isSelf
                        ? t('profile.rep.kickedSelfOne')
                        : t('profile.rep.kickedOtherOne', { name })
                    : isSelf
                      ? t('profile.rep.kickedSelfMany', { n: kicks })
                      : t('profile.rep.kickedOtherMany', { name, n: kicks }),
        });
    }

    return (
        <View style={styles.wrap}>
            <Text style={styles.sectionLabel}>{t('profile.reputation')}</Text>
            <View style={styles.stack}>
                {insights.map((item) => (
                    <View key={item.key} style={styles.card}>
                        <View style={[styles.iconBubble, toneStyle(item.tone).bg]}>
                            <Ionicons name={item.icon} size={15} color={toneStyle(item.tone).fg} />
                        </View>
                        <Text style={[styles.lineText, item.tone === 'red' && styles.kickText]}>
                            {item.text}
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

function toneStyle(tone: Insight['tone']) {
    switch (tone) {
        case 'green':
            return { bg: styles.iconGreen, fg: SUCCESS };
        case 'amber':
            return { bg: styles.iconAmber, fg: AMBER };
        case 'red':
            return { bg: styles.iconRed, fg: DANGER };
        default:
            return { bg: styles.iconBlue, fg: PRIMARY_DARK };
    }
}

const styles = StyleSheet.create({
    wrap: {
        width: '100%',
        marginTop: 22,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: MUTED,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginBottom: 10,
        paddingHorizontal: 2,
    },
    stack: {
        gap: 10,
    },
    card: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#E8EEF5',
        paddingVertical: 14,
        paddingHorizontal: 14,
    },
    iconBubble: {
        width: 32,
        height: 32,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 1,
    },
    iconBlue: { backgroundColor: '#DBEAFE' },
    iconGreen: { backgroundColor: '#D1FAE5' },
    iconAmber: { backgroundColor: '#FEF3C7' },
    iconRed: { backgroundColor: '#FEE2E2' },
    lineText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: INK,
        lineHeight: 21,
    },
    kickText: {
        color: MUTED,
    },
});
