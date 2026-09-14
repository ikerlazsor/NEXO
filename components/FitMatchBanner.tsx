import { StyleSheet, Text, View } from 'react-native';
import { feedFitTone } from '../lib/feedAffinity';
import { useThemedStyles } from '../lib/appTheme';
import type { ThemeColors } from '../theme';

type Props = {
    pct: number;
    label: string;
    /** Margen superior/inferior (tarjeta del feed). */
    compact?: boolean;
    /** Detalle del plan: menos aire debajo del aviso de encaje. */
    detail?: boolean;
};

/**
 * Colores por rango (llamativos pero naturales):
 * 60–69 azul, 70–79 verde hierba, 80–89 azul más vivo, 90+ terracota.
 */
export function FitMatchBanner({ pct, label, compact = false, detail = false }: Props) {
    const tone = feedFitTone(pct);
    const styles = useThemedStyles(createFitMatchBannerStyles);
    return (
        <View
            style={[
                styles.banner,
                styles[`banner_${tone}`],
                compact && styles.bannerCompact,
                detail && styles.bannerDetail,
            ]}
        >
            <Text style={[styles.text, styles[`text_${tone}`]]}>{label}</Text>
        </View>
    );
}

function createFitMatchBannerStyles(_c: ThemeColors, isDark: boolean) {
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
        bannerCompact: {
            marginTop: 10,
            marginBottom: 10,
        },
        bannerDetail: {
            marginTop: 8,
            marginBottom: 2,
        },
        banner_soft: {
            backgroundColor: isDark ? '#1E3A5F' : '#E8F1FA',
            borderColor: isDark ? '#5B8FC7' : '#7BA3C9',
        },
        banner_mid: {
            backgroundColor: isDark ? '#1F3D2A' : '#E6F2E4',
            borderColor: isDark ? '#6BA87A' : '#6F9B6A',
        },
        banner_high: {
            backgroundColor: isDark ? '#1A3558' : '#DCEAF6',
            borderColor: isDark ? '#4F8FCB' : '#4A7FB5',
            borderWidth: 1.5,
        },
        banner_elite: {
            backgroundColor: isDark ? '#4A2E24' : '#F3E6DE',
            borderColor: isDark ? '#C48B6A' : '#C47A52',
            borderWidth: 1.5,
        },
        text: {
            fontWeight: '800',
            fontSize: 13,
            textAlign: 'center',
        },
        text_soft: { color: isDark ? '#B7D0EA' : '#2F5F8F' },
        text_mid: { color: isDark ? '#B5D6B8' : '#3D6B3C', fontSize: 13.5 },
        text_high: { color: isDark ? '#A9C8E8' : '#2A5A8C', fontSize: 13.5 },
        text_elite: { color: isDark ? '#E8C4AE' : '#8B4E32', fontSize: 14, letterSpacing: 0.1 },
    });
}
