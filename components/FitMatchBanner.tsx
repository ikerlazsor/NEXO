import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { feedFitTone } from '../lib/feedAffinity';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import type { ThemeColors } from '../theme';

type Props = {
    pct: number;
    label: string;
    /** Margen superior/inferior (tarjeta del feed). */
    compact?: boolean;
    /** Detalle del plan: diana + subtítulo por rango. */
    detail?: boolean;
};

const ICON_COLORS = {
    soft: '#2F5F8F',
    mid: '#3D6B3C',
    high: '#2A5A8C',
    elite: '#8B4E32',
} as const;

/**
 * Colores por rango (llamativos pero naturales):
 * 60–69 azul, 70–79 verde hierba, 80–89 azul más vivo, 90+ terracota.
 */
export function FitMatchBanner({ pct, label, compact = false, detail = false }: Props) {
    const tone = feedFitTone(pct);
    const styles = useThemedStyles(createFitMatchBannerStyles);
    const { t } = useT();
    const subKey = `card.fitMatchSub.${tone}`;
    const subtitle = t(subKey);
    const showSub = detail && subtitle !== subKey;

    if (detail) {
        return (
            <View style={[styles.banner, styles[`banner_${tone}`], styles.bannerDetail, styles.bannerDetailRow]}>
                <View style={[styles.iconWrap, styles[`iconWrap_${tone}`]]}>
                    <Ionicons name="locate" size={22} color={ICON_COLORS[tone]} />
                </View>
                <View style={styles.detailCopy}>
                    <Text style={[styles.text, styles.textDetail, styles[`text_${tone}`]]}>{label}</Text>
                    {showSub ? (
                        <Text style={[styles.sub, styles[`sub_${tone}`]]}>{subtitle}</Text>
                    ) : null}
                </View>
            </View>
        );
    }

    if (compact) {
        return (
            <Text style={[styles.compactLine, styles[`text_${tone}`]]}>
                {t('card.fitMatchLead')}{' '}
                <Text style={styles.compactPct}>{pct}%</Text>
                {' '}{t('card.fitMatchTrail')}
            </Text>
        );
    }

    return (
        <View
            style={[
                styles.banner,
                styles[`banner_${tone}`],
            ]}
        >
            <Text style={[styles.text, styles[`text_${tone}`]]}>{label}</Text>
        </View>
    );
}

function createFitMatchBannerStyles(_c: ThemeColors) {
    return StyleSheet.create({
        banner: {
            borderRadius: 12,
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderWidth: 1,
            marginTop: 10,
            marginBottom: 10,
            alignItems: 'center',
        },
        compactLine: {
            marginTop: 6,
            marginBottom: 2,
            fontSize: 13,
            fontWeight: '500',
            lineHeight: 18,
        },
        compactPct: {
            fontWeight: '800',
        },
        bannerDetail: {
            marginTop: 8,
            marginBottom: 2,
            paddingVertical: 14,
            paddingHorizontal: 14,
            borderRadius: 16,
            minHeight: 64,
        },
        bannerDetailRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
        },
        iconWrap: {
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
        },
        iconWrap_soft: { backgroundColor: '#D5E6F5' },
        iconWrap_mid: { backgroundColor: '#D4EBD0' },
        iconWrap_high: { backgroundColor: '#C9DFF0' },
        iconWrap_elite: { backgroundColor: '#EBD9CE' },
        detailCopy: { flex: 1, minWidth: 0, gap: 3 },
        banner_soft: {
            backgroundColor: '#E8F1FA',
            borderColor: '#7BA3C9',
        },
        banner_mid: {
            backgroundColor: '#E6F2E4',
            borderColor: '#6F9B6A',
        },
        banner_high: {
            backgroundColor: '#DCEAF6',
            borderColor: '#4A7FB5',
            borderWidth: 1.5,
        },
        banner_elite: {
            backgroundColor: '#F3E6DE',
            borderColor: '#C47A52',
            borderWidth: 1.5,
        },
        text: {
            fontWeight: '800',
            fontSize: 13,
            textAlign: 'center',
        },
        textDetail: {
            textAlign: 'left',
            fontSize: 14,
            lineHeight: 19,
        },
        text_soft: { color: '#2F5F8F' },
        text_mid: { color: '#3D6B3C' },
        text_high: { color: '#2A5A8C' },
        text_elite: { color: '#8B4E32', letterSpacing: 0.1 },
        sub: {
            fontWeight: '500',
            fontSize: 12.5,
            lineHeight: 17,
            textAlign: 'left',
        },
        sub_soft: { color: '#4A7199' },
        sub_mid: { color: '#4F7A4C' },
        sub_high: { color: '#3D6A9A' },
        sub_elite: { color: '#A06648' },
    });
}
