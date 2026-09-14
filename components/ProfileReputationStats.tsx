import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useT } from '../lib/i18n';
import { useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import { getAspectLabel } from '../lib/ratings';
import { topAttendedCategory, type BadgeStats } from '../lib/badgeStats';
import { MAIN_CATEGORY_ICONS, type MainCategoryId } from '../lib/categories';
import { hasPublicTraitStats, type UserStats } from '../lib/stats';
import type { AffinityLevel } from '../lib/profileAffinity';

const INK = '#0F172A';
const MUTED = '#64748B';
const SUCCESS = '#059669';

const CAT_THEME: Record<MainCategoryId, { bg: string; fg: string; iconBg: string }> = {
    FOODIES: { bg: '#FFF7ED', fg: '#C2410C', iconBg: '#FFEDD5' },
    DEPORTES: { bg: '#EFF6FF', fg: '#1D4ED8', iconBg: '#DBEAFE' },
    AIRE_LIBRE: { bg: '#ECFDF5', fg: '#047857', iconBg: '#D1FAE5' },
    SHOWTIME: { bg: '#F5F3FF', fg: '#6D28D9', iconBg: '#EDE9FE' },
    DESCUBRIR: { bg: '#FFFBEB', fg: '#B45309', iconBg: '#FEF3C7' },
    VIBES: { bg: '#FDF2F8', fg: '#BE185D', iconBg: '#FCE7F3' },
};

const THERMO_COLORS = ['#DC2626', '#F97316', '#2DD4BF', '#22C55E', '#F5C542'] as const;
const SUPER_GOLD = '#F5C542';
const SUPER_GOLD_DEEP = '#B45309';

type Props = {
    stats: UserStats | BadgeStats;
    isSelf?: boolean;
    genero?: string | null;
    affinityLevel?: AffinityLevel;
    showThermo?: boolean;
    /** Comunidad: solo rasgos (sin termómetro ni «lo suyo»). */
    variant?: 'person' | 'organizer';
};

function upperFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLocaleUpperCase('es') + value.slice(1);
}

function AffinityThermo({ level }: { level: AffinityLevel }) {
    const { t } = useT();
    const styles = useThemedStyles(createRepStyles);
    const isSuper = level === 4;
    const color = isSuper ? SUPER_GOLD : THERMO_COLORS[level];
    const tubeInnerH = 76;
    const fillH = level <= 0 ? 0 : Math.max(10, Math.round((level / 4) * tubeInnerH));

    return (
        <View style={styles.thermoCol}>
            <View style={styles.thermoStack}>
                {isSuper ? (
                    <View style={styles.superSparkle} pointerEvents="none">
                        <Ionicons name="sparkles" size={13} color={SUPER_GOLD} />
                    </View>
                ) : null}
                <View style={[styles.thermoTubeOuter, isSuper && styles.thermoTubeOuterSuper]}>
                    <View style={[styles.thermoTubeInner, { height: tubeInnerH }]}>
                        <View style={styles.thermoFillTrack}>
                            {isSuper ? (
                                <LinearGradient
                                    colors={['#FFF4C4', SUPER_GOLD, '#D97706']}
                                    start={{ x: 0.5, y: 0 }}
                                    end={{ x: 0.5, y: 1 }}
                                    style={[styles.thermoFill, { height: fillH }]}
                                />
                            ) : (
                                <View
                                    style={[
                                        styles.thermoFill,
                                        { height: fillH, backgroundColor: color },
                                    ]}
                                />
                            )}
                        </View>
                        <View style={styles.thermoTicks} pointerEvents="none">
                            {[0.25, 0.5, 0.75].map((mark) => (
                                <View
                                    key={mark}
                                    style={[styles.thermoTick, { bottom: Math.round(mark * tubeInnerH) }]}
                                />
                            ))}
                        </View>
                    </View>
                </View>
                {isSuper ? (
                    <LinearGradient
                        colors={['#FFE58A', SUPER_GOLD, '#B45309']}
                        start={{ x: 0.2, y: 0 }}
                        end={{ x: 0.8, y: 1 }}
                        style={[styles.thermoBulb, styles.thermoBulbSuper]}
                    />
                ) : (
                    <View style={[styles.thermoBulb, { backgroundColor: color }]} />
                )}
            </View>
            <Text style={styles.thermoKicker} numberOfLines={2}>{t('profile.aff.kicker')}</Text>
            <Text
                style={[
                    styles.thermoTitle,
                    { color: isSuper ? SUPER_GOLD_DEEP : color },
                    isSuper && styles.thermoTitleSuper,
                ]}
                numberOfLines={2}
            >
                {t(`profile.aff.other.${level}`)}
            </Text>
        </View>
    );
}

export function ProfileReputationStats({
    stats,
    isSelf,
    genero,
    affinityLevel = 0,
    showThermo,
    variant = 'person',
}: Props) {
    const { t } = useT();
    const styles = useThemedStyles(createRepStyles);
    const badgeStats = stats as BadgeStats;
    const isOrganizer = variant === 'organizer';
    const posLabel = hasPublicTraitStats(badgeStats) && badgeStats.aspectoPositivoMasVotado
        ? upperFirst(getAspectLabel('pos', badgeStats.aspectoPositivoMasVotado, genero, t))
        : null;
    const negLabel =
        posLabel && hasPublicTraitStats(badgeStats) && badgeStats.aspectoNegativoMasVotado
            ? upperFirst(getAspectLabel('neg', badgeStats.aspectoNegativoMasVotado, genero, t))
            : null;
    const loSuyo = isOrganizer ? null : topAttendedCategory(badgeStats);
    const catTheme = loSuyo ? CAT_THEME[loSuyo] : null;
    const own = !!isSelf;
    const thermo = isOrganizer ? false : (showThermo ?? !own);

    return (
        <View style={styles.wrap}>
            <View style={[styles.card, (!thermo || isOrganizer) && styles.cardSelf]}>
                {thermo ? <AffinityThermo level={affinityLevel} /> : null}

                <View style={[styles.traits, (!thermo || isOrganizer) && !negLabel && styles.traitsSelf]}>
                    <View style={[styles.block, styles.blockSpoiler, (!thermo || isOrganizer) && styles.blockSelf]}>
                        <View style={styles.blockTopRow}>
                            <View style={styles.spoilerIcon}>
                                <Ionicons name="sparkles" size={15} color={SUCCESS} />
                            </View>
                            <View style={styles.kickerPillSpoiler}>
                                <Text style={[styles.kicker, styles.kickerSpoiler]}>
                                    {t(own ? 'profile.rep.peopleSee' : 'profile.rep.peopleSeeOther')}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.blockBody}>
                            {posLabel ? (
                                <Text style={styles.blockTitle}>{posLabel}</Text>
                            ) : (
                                <Text style={styles.blockMuted}>{t('profile.rep.peopleSeeEmpty')}</Text>
                            )}
                        </View>
                    </View>

                    {!isOrganizer ? (
                    <View
                        style={[
                            styles.block,
                            catTheme && { backgroundColor: catTheme.bg, borderColor: `${catTheme.fg}22` },
                            !thermo && styles.blockSelf,
                        ]}
                    >
                        <View style={styles.blockTopRow}>
                            <View
                                style={[
                                    styles.catIcon,
                                    { backgroundColor: catTheme?.iconBg ?? '#EEF2FF' },
                                ]}
                            >
                                <Ionicons
                                    name={(loSuyo ? MAIN_CATEGORY_ICONS[loSuyo] : 'compass-outline') as keyof typeof Ionicons.glyphMap}
                                    size={15}
                                    color={catTheme?.fg ?? '#4F46E5'}
                                />
                            </View>
                            <View style={[styles.kickerPill, catTheme && { backgroundColor: `${catTheme.fg}14` }]}>
                                <Text style={[styles.kicker, catTheme && { color: catTheme.fg }]}>
                                    {t(own ? 'profile.rep.loTuyo' : 'profile.rep.loSuyo')}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.blockBody}>
                            {loSuyo ? (
                                <Text style={styles.blockTitle}>{t(`cat.main.${loSuyo}`)}</Text>
                            ) : (
                                <Text style={styles.blockMuted}>
                                    {t(own ? 'profile.rep.loTuyoEmpty' : 'profile.rep.loSuyoEmpty')}
                                </Text>
                            )}
                        </View>
                    </View>
                    ) : null}

                    {negLabel ? (
                        <View style={[styles.block, styles.blockNeg, (!thermo || isOrganizer) && styles.blockSelf]}>
                            <View style={styles.blockTopRow}>
                                <View style={styles.negIcon}>
                                    <MaterialCommunityIcons name="emoticon-frown-outline" size={16} color="#B45309" />
                                </View>
                                <View style={styles.kickerPillNeg}>
                                    <Text style={[styles.kicker, styles.kickerNeg]}>
                                        {t(own ? 'profile.rep.improve' : 'profile.rep.improveOtherShort')}
                                    </Text>
                                </View>
                            </View>
                            <View style={styles.blockBody}>
                                <Text style={styles.blockTitle}>{negLabel}</Text>
                            </View>
                        </View>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

function createRepStyles(c: ThemeColors) {
    const INK = c.text;
    const MUTED = c.textMuted;
    return StyleSheet.create({
    wrap: {
        width: '100%',
        marginTop: 24,
        paddingHorizontal: 20,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        paddingVertical: 14,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
    },
    cardSelf: {
        alignItems: 'stretch',
        paddingVertical: 12,
        paddingHorizontal: 12,
    },
    thermoCol: {
        width: 108,
        alignItems: 'center',
        gap: 6,
    },
    thermoStack: {
        alignItems: 'center',
        position: 'relative',
    },
    superSparkle: {
        position: 'absolute',
        top: -10,
        right: -4,
        zIndex: 3,
    },
    thermoTubeOuter: {
        width: 22,
        borderRadius: 11,
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        backgroundColor: c.surfaceSubtle,
        borderWidth: 1.5,
        borderColor: c.border,
        padding: 3,
        marginBottom: -7,
        zIndex: 1,
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
    },
    thermoTubeOuterSuper: {
        borderColor: '#F5C542',
        backgroundColor: '#FFFBEB',
    },
    thermoTubeInner: {
        width: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: c.border,
        position: 'relative',
    },
    thermoFillTrack: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
    },
    thermoFill: {
        width: '100%',
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        minHeight: 0,
    },
    thermoTicks: {
        ...StyleSheet.absoluteFillObject,
    },
    thermoTick: {
        position: 'absolute',
        left: 1,
        right: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(15,23,42,0.12)',
    },
    thermoBulb: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 3,
        borderColor: c.background,
        zIndex: 2,
        shadowColor: '#0F172A',
        shadowOpacity: 0.12,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
    },
    thermoBulbSuper: {
        borderColor: '#FFF4C4',
        shadowColor: '#F59E0B',
        shadowOpacity: 0.85,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
        elevation: 6,
    },
    thermoKicker: {
        fontSize: 10,
        fontWeight: '800',
        color: MUTED,
        letterSpacing: 0.15,
        textAlign: 'center',
        marginTop: 4,
    },
    thermoTitle: {
        fontSize: 13,
        fontWeight: '800',
        textAlign: 'center',
        lineHeight: 16,
    },
    thermoTitleSuper: {
        fontSize: 14,
        letterSpacing: 0.2,
        textShadowColor: 'rgba(245, 197, 66, 0.55)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
    },
    traits: { flex: 1, gap: 7, minWidth: 0 },
    traitsSelf: {
        flexDirection: 'column',
        gap: 10,
        flex: 1,
    },
    block: {
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        borderRadius: 18,
        paddingVertical: 12,
        paddingHorizontal: 12,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
    },
    blockSelf: {
        flex: undefined,
        width: '100%',
        minWidth: 0,
    },
    blockSpoiler: {
        backgroundColor: '#F0FDF9',
        borderColor: '#A7F3D0',
    },
    blockNeg: {
        backgroundColor: '#FFFBEB',
        borderColor: '#FDE68A',
    },
    blockTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    spoilerIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#D1FAE5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    negIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#FFEDD5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    catIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    kickerPill: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: c.surfaceSubtle,
    },
    kickerPillSpoiler: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: '#D1FAE5',
    },
    kickerPillNeg: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: '#FFEDD5',
    },
    blockBody: { flex: 1, minWidth: 0, paddingLeft: 2 },
    kicker: {
        fontSize: 10,
        fontWeight: '800',
        color: MUTED,
        letterSpacing: 0.35,
        textTransform: 'uppercase',
    },
    kickerSpoiler: { color: SUCCESS },
    kickerNeg: { color: '#B45309' },
    blockTitle: { fontSize: 15, fontWeight: '800', color: INK, lineHeight: 20 },
    blockMuted: { fontSize: 13, fontWeight: '600', color: MUTED, lineHeight: 18 },
    });
}
