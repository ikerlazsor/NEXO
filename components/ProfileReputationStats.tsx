import { StyleSheet, Text, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import { getAspectLabel } from '../lib/ratings';
import { topAttendedCategory, type BadgeStats } from '../lib/badgeStats';
import { type MainCategoryId } from '../lib/categories';
import { hasPublicTraitStats, type UserStats } from '../lib/stats';
import type { AffinityLevel } from '../lib/profileAffinity';
import { ProfileAvatar } from './ProfileAvatar';

const SUCCESS = '#059669';

const TRAIT_IMAGES: Record<string, number> = {
    agradable: require('../assets/images/buen rollo.png'),
    puntual: require('../assets/images/puntual.png'),
    respetuoso: require('../assets/images/respetuoso.png'),
    cercano: require('../assets/images/cercano.png'),
    divertido: require('../assets/images/divertido.png'),
    social: require('../assets/images/social.png'),
};

const CAT_IMAGES: Record<MainCategoryId, number> = {
    FOODIES: require('../assets/images/foodie.png'),
    DEPORTES: require('../assets/images/deporte.png'),
    AIRE_LIBRE: require('../assets/images/aire libre.png'),
    SHOWTIME: require('../assets/images/showtime.png'),
    DESCUBRIR: require('../assets/images/descubrir.png'),
    VIBES: require('../assets/images/ocio.png'),
};

const CAT_THEME: Record<
    MainCategoryId,
    { bg: string; fg: string; iconBg: string }
> = {
    FOODIES: { bg: '#FFF7ED', fg: '#C2410C', iconBg: '#FFEDD5' },
    DEPORTES: { bg: '#EFF6FF', fg: '#1D4ED8', iconBg: '#DBEAFE' },
    AIRE_LIBRE: { bg: '#ECFDF5', fg: '#047857', iconBg: '#D1FAE5' },
    SHOWTIME: { bg: '#F5F3FF', fg: '#6D28D9', iconBg: '#EDE9FE' },
    DESCUBRIR: { bg: '#FFFBEB', fg: '#B45309', iconBg: '#FEF3C7' },
    VIBES: { bg: '#FDF2F8', fg: '#BE185D', iconBg: '#FCE7F3' },
};

const EMPTY_TRAIT_IMAGE = require('../assets/images/no hay votos en la gente destaca.png');
const EMPTY_CAT_IMAGE = require('../assets/images/Vacio lo tuyo.png');

/** Avatares laterales; burbuja de afinidad fija a 116px. */
const AFF_AVATAR = 140;
const AFF_BUBBLE = 116;

const AFF_COLORS = [
    '#F87171',
    '#FB7185',
    '#FB923C',
    '#FBBF24',
    '#A3E635',
    '#2DD4BF',
    '#22C55E',
    '#16A34A',
    '#F5C542',
    '#EAB308',
] as const;

const AFF_TITLE_DARK = new Set<string>(['#FBBF24', '#A3E635', '#F5C542', '#EAB308']);

type Props = {
    stats: UserStats | BadgeStats;
    isSelf?: boolean;
    genero?: string | null;
    affinityLevel?: AffinityLevel;
    affinityScore?: number;
    showAffinity?: boolean;
    /** @deprecated Usar showAffinity */
    showThermo?: boolean;
    viewerAvatarUrl?: string | null;
    viewerName?: string | null;
    targetAvatarUrl?: string | null;
    targetName?: string | null;
    variant?: 'person' | 'organizer';
};

function upperFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLocaleUpperCase('es') + value.slice(1);
}

function traitBlurbKey(traitKey: string, own: boolean, genero?: string | null): string {
    const who = own ? 'self' : genero === 'femenino' ? 'her' : 'him';
    return `profile.rep.traitBlurb.${traitKey}.${who}`;
}

function catBlurbText(
    cat: string,
    own: boolean,
    t: (k: string) => string,
): string {
    const specific = own ? `profile.rep.catBlurb.${cat}.self` : `profile.rep.catBlurb.${cat}.other`;
    const specificVal = t(specific);
    if (specificVal !== specific) return specificVal;
    return t(`profile.rep.catBlurb.${cat}`);
}

function ArtImage({ source }: { source: number }) {
    return (
        <View style={stylesStatic.artSlot} pointerEvents="none">
            <Image source={source} style={stylesStatic.artImage} resizeMode="contain" />
        </View>
    );
}

export function ProfileReputationStats({
    stats,
    isSelf,
    genero,
    affinityLevel = 0,
    affinityScore,
    showAffinity,
    showThermo,
    viewerAvatarUrl,
    viewerName,
    targetAvatarUrl,
    targetName,
    variant = 'person',
}: Props) {
    const { t } = useT();
    const styles = useThemedStyles(createRepStyles);
    const badgeStats = stats as BadgeStats;
    const isOrganizer = variant === 'organizer';
    const posKey =
        hasPublicTraitStats(badgeStats) && badgeStats.aspectoPositivoMasVotado
            ? badgeStats.aspectoPositivoMasVotado
            : null;
    const posLabel = posKey ? upperFirst(getAspectLabel('pos', posKey, genero, t)) : null;
    const negLabel =
        posLabel && hasPublicTraitStats(badgeStats) && badgeStats.aspectoNegativoMasVotado
            ? upperFirst(getAspectLabel('neg', badgeStats.aspectoNegativoMasVotado, genero, t))
            : null;
    const loSuyo = isOrganizer ? null : topAttendedCategory(badgeStats);
    const catTheme = loSuyo ? CAT_THEME[loSuyo] : null;
    const own = !!isSelf;
    const affinityOn = isOrganizer
        ? false
        : (showAffinity ?? showThermo ?? !own);

    const pct =
        typeof affinityScore === 'number' && Number.isFinite(affinityScore)
            ? Math.max(0, Math.min(100, Math.round(affinityScore)))
            : null;
    const affColor = AFF_COLORS[affinityLevel] ?? AFF_COLORS[0];
    const traitImage = posKey ? TRAIT_IMAGES[posKey] : null;
    const catImage = loSuyo ? CAT_IMAGES[loSuyo] : null;

    return (
        <View style={styles.wrap}>
            <View style={[styles.highlightCard, styles.highlightGreen]}>
                <View style={styles.highlightCopy}>
                    <Text style={styles.highlightKicker}>
                        {t(own ? 'profile.rep.peopleSee' : 'profile.rep.peopleSeeOther')}
                    </Text>
                    {posLabel && posKey ? (
                        <>
                            <Text style={styles.highlightTrait}>{posLabel}</Text>
                            <Text style={styles.highlightBlurb}>
                                {t(traitBlurbKey(posKey, own, genero))}
                            </Text>
                        </>
                    ) : (
                        <Text style={styles.highlightEmpty}>{t('profile.rep.peopleSeeEmpty')}</Text>
                    )}
                </View>
                <ArtImage source={traitImage ?? EMPTY_TRAIT_IMAGE} />
            </View>

            {!isOrganizer ? (
                <View
                    style={[
                        styles.highlightCard,
                        catTheme
                            ? { backgroundColor: catTheme.bg, borderColor: `${catTheme.fg}33` }
                            : styles.catFallback,
                    ]}
                >
                    <View style={styles.highlightCopy}>
                        <Text style={[styles.highlightKicker, catTheme && { color: catTheme.fg }]}>
                            {t(own ? 'profile.rep.loTuyo' : 'profile.rep.loSuyo')}
                        </Text>
                        {loSuyo && catTheme ? (
                            <>
                                <Text style={styles.highlightTrait}>{t(`cat.main.${loSuyo}`)}</Text>
                                <Text style={[styles.highlightBlurb, { color: `${catTheme.fg}CC` }]}>
                                    {catBlurbText(loSuyo, own, t)}
                                </Text>
                            </>
                        ) : (
                            <Text style={styles.highlightEmpty}>
                                {t(own ? 'profile.rep.loTuyoEmpty' : 'profile.rep.loSuyoEmpty')}
                            </Text>
                        )}
                    </View>
                    <ArtImage source={catImage ?? EMPTY_CAT_IMAGE} />
                </View>
            ) : null}

            {affinityOn && pct != null ? (
                <View style={styles.affinityBlock}>
                    <View style={styles.affinityAvatars}>
                        <ProfileAvatar
                            uri={viewerAvatarUrl}
                            name={viewerName || 'Tú'}
                            size={AFF_AVATAR}
                            recyclingKey="aff-viewer"
                        />
                        <View style={[styles.pctBubble, { backgroundColor: affColor }]}>
                            <Text style={styles.pctText}>{pct}%</Text>
                            <Text style={styles.pctLabel}>{t('profile.aff.bubble')}</Text>
                        </View>
                        <ProfileAvatar
                            uri={targetAvatarUrl}
                            name={targetName || 'U'}
                            size={AFF_AVATAR}
                            recyclingKey="aff-target"
                        />
                    </View>
                    <Text
                        style={[
                            styles.affTitle,
                            { color: AFF_TITLE_DARK.has(affColor) ? '#B45309' : affColor },
                        ]}
                    >
                        {t(`profile.aff.title.${affinityLevel}`)}
                    </Text>
                    <Text style={styles.affBlurb}>{t(`profile.aff.blurb.${affinityLevel}`)}</Text>
                </View>
            ) : null}

            {negLabel ? (
                <View style={[styles.highlightCard, styles.improveCard]}>
                    <View style={styles.highlightCopy}>
                        <Text style={[styles.highlightKicker, styles.improveKicker]}>
                            {t(own ? 'profile.rep.improve' : 'profile.rep.improveOtherShort')}
                        </Text>
                        <Text style={styles.highlightTrait}>{negLabel}</Text>
                    </View>
                    <View style={stylesStatic.improveIcon}>
                        <MaterialCommunityIcons name="emoticon-frown-outline" size={40} color="#B45309" />
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const stylesStatic = StyleSheet.create({
    artSlot: {
        width: 152,
        height: 152,
        marginRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    artImage: {
        width: 152,
        height: 152,
    },
    improveIcon: {
        width: 72,
        height: 72,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

function createRepStyles(c: ThemeColors) {
    const INK = c.text;
    const MUTED = c.textMuted;
    return StyleSheet.create({
        wrap: {
            width: '100%',
            marginTop: 24,
            paddingHorizontal: 20,
            gap: 12,
        },
        highlightCard: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            borderRadius: 22,
            paddingVertical: 7,
            paddingLeft: 14,
            paddingRight: 10,
            borderWidth: 1,
            overflow: 'hidden',
        },
        highlightGreen: {
            backgroundColor: '#ECFDF5',
            borderColor: '#A7F3D0',
        },
        catFallback: {
            backgroundColor: c.surfaceSubtle,
            borderColor: c.border,
        },
        improveCard: {
            backgroundColor: '#FFFBEB',
            borderColor: '#FDE68A',
        },
        highlightCopy: {
            flex: 1,
            minWidth: 0,
            gap: 4,
            paddingRight: 8,
        },
        highlightKicker: {
            fontSize: 13,
            fontWeight: '800',
            color: SUCCESS,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
        },
        improveKicker: {
            color: '#B45309',
        },
        highlightTrait: {
            fontSize: 23,
            fontWeight: '800',
            color: INK,
            letterSpacing: -0.4,
            lineHeight: 28,
        },
        highlightBlurb: {
            fontSize: 14,
            fontWeight: '600',
            color: MUTED,
            lineHeight: 19,
        },
        highlightEmpty: {
            fontSize: 15,
            fontWeight: '700',
            color: MUTED,
            marginTop: 2,
        },
        affinityBlock: {
            marginTop: 8,
            alignItems: 'center',
            paddingVertical: 8,
        },
        affinityAvatars: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            marginBottom: 14,
        },
        pctBubble: {
            width: AFF_BUBBLE,
            height: AFF_BUBBLE,
            borderRadius: AFF_BUBBLE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 0,
            marginHorizontal: -18,
            zIndex: 2,
        },
        pctText: {
            fontSize: 28,
            fontWeight: '900',
            color: '#FFF',
            letterSpacing: -0.5,
        },
        pctLabel: {
            fontSize: 12,
            fontWeight: '800',
            color: 'rgba(255,255,255,0.92)',
            textTransform: 'uppercase',
            letterSpacing: 0.35,
            marginTop: 2,
        },
        affTitle: {
            fontSize: 22,
            fontWeight: '800',
            textAlign: 'center',
            letterSpacing: -0.3,
        },
        affBlurb: {
            marginTop: 6,
            fontSize: 14,
            fontWeight: '600',
            color: MUTED,
            textAlign: 'center',
            lineHeight: 20,
            paddingHorizontal: 12,
        },
    });
}
