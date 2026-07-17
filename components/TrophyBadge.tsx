import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    metalForPreview,
    type BadgeShape,
    type TrophyMetal,
    type UserBadge,
} from '../lib/badges';
import { useT } from '../lib/i18n';

const INK = '#0F2A4A';
const MUTED = '#64748B';

export const METAL_PALETTE: Record<
    TrophyMetal,
    { colors: [string, string, ...string[]]; rim: string; glow?: string; accent?: string }
> = {
    locked: { colors: ['#E2E8F0', '#94A3B8'], rim: '#64748B', accent: '#94A3B8' },
    bronze: { colors: ['#F0C987', '#CD7F32', '#8B5A2B'], rim: '#6B4423', glow: '#CD7F3244', accent: '#FFF8E7' },
    silver: { colors: ['#F5F5F5', '#C0C0C0', '#808080'], rim: '#5C5C5C', glow: '#C0C0C044', accent: '#FFFFFF' },
    gold: { colors: ['#FFF4B8', '#FFD700', '#DAA520'], rim: '#B8860B', glow: '#FFD70044', accent: '#FFFDE7' },
    elite: { colors: ['#C4B5FD', '#818CF8', '#6366F1'], rim: '#4338CA', glow: '#6366F144', accent: '#EEF2FF' },
    legendary: { colors: ['#E0F2FE', '#7DD3FC', '#38BDF8', '#0284C7'], rim: '#0369A1', glow: '#38BDF866', accent: '#F0F9FF' },
    welcome: { colors: ['#93C5FD', '#4DA6FF', '#2563EB'], rim: '#1D4ED8', glow: '#2563EB55', accent: '#EFF6FF' },
};

interface TrophyProps {
    shape: BadgeShape;
    metal: TrophyMetal;
    size?: 'grid' | 'modal' | 'preview' | 'hero';
}

const SIZE_MAP = {
    grid: 52,
    preview: 56,
    modal: 88,
    hero: 48,
} as const;

export function TrophyIcon({ shape, metal, size = 'grid' }: TrophyProps) {
    const dim = SIZE_MAP[size];
    const palette = METAL_PALETTE[metal];
    const locked = metal === 'locked';

    return (
        <View style={[styles.iconRoot, { width: dim, height: dim }]}>
            {!locked && palette.glow ? (
                <View
                    style={[
                        styles.glow,
                        {
                            backgroundColor: palette.glow,
                            width: dim * 1.15,
                            height: dim * 1.15,
                        },
                    ]}
                />
            ) : null}
            <BadgeSilhouette shape={shape} dim={dim} palette={palette} locked={locked} />
        </View>
    );
}

type Palette = (typeof METAL_PALETTE)[TrophyMetal];

function BadgeSilhouette({
    shape,
    dim,
    palette,
    locked,
}: {
    shape: BadgeShape;
    dim: number;
    palette: Palette;
    locked: boolean;
}) {
    const rim = palette.rim;
    const accent = palette.accent ?? '#FFFFFF';

    switch (shape) {
        case 'medal_welcome':
            return (
                <View style={{ alignItems: 'center' }}>
                    <LinearGradient
                        colors={palette.colors}
                        style={[
                            styles.starMedal,
                            {
                                width: dim * 0.78,
                                height: dim * 0.78,
                                borderColor: rim,
                            },
                        ]}
                    >
                        <View style={[styles.starInner, { borderColor: accent }]} />
                    </LinearGradient>
                    <View style={[styles.ribbonLeft, { backgroundColor: rim, width: dim * 0.18, height: dim * 0.28 }]} />
                    <View style={[styles.ribbonRight, { backgroundColor: rim, width: dim * 0.18, height: dim * 0.28 }]} />
                </View>
            );

        case 'medal_round':
            return (
                <View style={{ alignItems: 'center' }}>
                    <LinearGradient
                        colors={palette.colors}
                        style={[
                            styles.roundMedal,
                            { width: dim * 0.72, height: dim * 0.72, borderColor: rim },
                        ]}
                    >
                        <View style={[styles.roundRing, { borderColor: accent }]} />
                    </LinearGradient>
                    <View style={[styles.vRibbon, { borderBottomColor: rim, width: dim * 0.14, height: dim * 0.22 }]} />
                    <View style={[styles.vRibbon, styles.vRibbonRight, { borderBottomColor: rim, width: dim * 0.14, height: dim * 0.22 }]} />
                </View>
            );

        case 'trophy_cup':
            return (
                <View style={{ alignItems: 'center', justifyContent: 'flex-end', height: dim }}>
                    <View style={[styles.cupHandle, styles.cupHandleL, { borderColor: rim, height: dim * 0.28 }]} />
                    <View style={[styles.cupHandle, styles.cupHandleR, { borderColor: rim, height: dim * 0.28 }]} />
                    <LinearGradient
                        colors={palette.colors}
                        style={[
                            styles.cupBowl,
                            { width: dim * 0.62, height: dim * 0.42, borderColor: rim },
                        ]}
                    />
                    <View style={[styles.cupStem, { width: dim * 0.1, height: dim * 0.14, backgroundColor: rim }]} />
                    <LinearGradient
                        colors={[palette.colors[0], rim]}
                        style={[styles.cupBase, { width: dim * 0.7, height: dim * 0.1, borderColor: rim }]}
                    />
                </View>
            );

        case 'star_burst':
            return (
                <LinearGradient
                    colors={palette.colors}
                    style={[
                        styles.burstStar,
                        { width: dim * 0.82, height: dim * 0.82, borderColor: rim },
                    ]}
                >
                    <View style={[styles.burstCore, { backgroundColor: accent }]} />
                </LinearGradient>
            );

        case 'hexagon':
            return (
                <LinearGradient
                    colors={palette.colors}
                    style={[
                        styles.hexagon,
                        { width: dim * 0.76, height: dim * 0.84, borderColor: rim },
                    ]}
                >
                    <View style={[styles.hexInner, { borderColor: accent }]} />
                </LinearGradient>
            );

        case 'shield':
            return (
                <LinearGradient
                    colors={palette.colors}
                    style={[
                        styles.shield,
                        { width: dim * 0.68, height: dim * 0.86, borderColor: rim },
                    ]}
                >
                    <View style={[styles.shieldChevron, { borderTopColor: accent }]} />
                </LinearGradient>
            );

        case 'block':
            return (
                <View style={{ alignItems: 'center' }}>
                    <LinearGradient
                        colors={palette.colors}
                        style={[
                            styles.blockTop,
                            { width: dim * 0.62, height: dim * 0.52, borderColor: rim },
                        ]}
                    />
                    <View style={[styles.blockBase, { width: dim * 0.78, height: dim * 0.14, backgroundColor: rim }]} />
                </View>
            );

        case 'wreath':
            return (
                <View style={[styles.wreathWrap, { width: dim * 0.82, height: dim * 0.82 }]}>
                    <LinearGradient
                        colors={palette.colors}
                        style={[styles.wreathRing, { borderColor: rim }]}
                    />
                    {[0, 60, 120, 180, 240, 300].map((deg) => (
                        <View
                            key={deg}
                            style={[
                                styles.wreathLeaf,
                                {
                                    backgroundColor: locked ? '#94A3B8' : palette.colors[1],
                                    transform: [{ rotate: `${deg}deg` }, { translateY: -dim * 0.36 }],
                                },
                            ]}
                        />
                    ))}
                </View>
            );

        case 'heart_shape':
            return (
                <View style={[styles.heartWrap, { width: dim * 0.8, height: dim * 0.76 }]}>
                    <LinearGradient
                        colors={palette.colors}
                        style={[styles.heartLobe, styles.heartLobeL, { borderColor: rim }]}
                    />
                    <LinearGradient
                        colors={palette.colors}
                        style={[styles.heartLobe, styles.heartLobeR, { borderColor: rim }]}
                    />
                    <LinearGradient
                        colors={palette.colors}
                        style={[styles.heartPoint, { borderBottomColor: rim }]}
                    />
                </View>
            );

        case 'nodes':
            return (
                <View style={[styles.nodesWrap, { width: dim * 0.8, height: dim * 0.8 }]}>
                    <LinearGradient colors={palette.colors} style={[styles.nodeCenter, { borderColor: rim }]} />
                    {[0, 72, 144, 216, 288].map((deg) => (
                        <View
                            key={deg}
                            style={[
                                styles.nodeOrbit,
                                {
                                    transform: [{ rotate: `${deg}deg` }, { translateY: -dim * 0.28 }],
                                },
                            ]}
                        >
                            <View style={[styles.nodeDot, { backgroundColor: rim }]} />
                            <View style={[styles.nodeLine, { backgroundColor: rim }]} />
                        </View>
                    ))}
                </View>
            );

        case 'compass_nav':
            return (
                <View style={[styles.compassWrap, { width: dim * 0.86, height: dim * 0.86 }]}>
                    <LinearGradient
                        colors={palette.colors}
                        style={[styles.compassDiamond, { borderColor: rim }]}
                    />
                    <View style={[styles.compassNeedleN, { borderBottomColor: accent }]} />
                    <View style={[styles.compassNeedleS, { borderTopColor: rim }]} />
                    <View style={[styles.compassNeedleE, { borderLeftColor: palette.colors[2] ?? rim }]} />
                    <View style={[styles.compassNeedleW, { borderRightColor: palette.colors[0] }]} />
                    <View style={[styles.compassHub, { backgroundColor: rim }]} />
                </View>
            );

        case 'crown_spike':
            return (
                <View style={{ alignItems: 'center' }}>
                    <View style={[styles.crownSpikes, { width: dim * 0.78 }]}>
                        {[0, 1, 2, 3, 4].map((i) => (
                            <LinearGradient
                                key={i}
                                colors={palette.colors}
                                style={[
                                    styles.crownSpike,
                                    {
                                        height: i === 2 ? dim * 0.38 : dim * 0.28,
                                        borderColor: rim,
                                    },
                                ]}
                            />
                        ))}
                    </View>
                    <LinearGradient
                        colors={palette.colors}
                        style={[styles.crownBand, { width: dim * 0.82, height: dim * 0.22, borderColor: rim }]}
                    />
                </View>
            );

        default:
            return (
                <LinearGradient
                    colors={palette.colors}
                    style={[styles.roundMedal, { width: dim * 0.72, height: dim * 0.72, borderColor: rim }]}
                />
            );
    }
}

interface BadgeTileProps {
    badge: UserBadge;
    onPress?: () => void;
}

export function BadgeTile({ badge, onPress }: BadgeTileProps) {
    const content = (
        <View style={styles.tile}>
            <TrophyIcon shape={badge.family.shape} metal={badge.metal} size="grid" />
            <Text style={[styles.tileName, !badge.unlocked && styles.tileNameLocked]} numberOfLines={2}>
                {badge.family.nombre}
            </Text>
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tilePress}>
                {content}
            </TouchableOpacity>
        );
    }
    return content;
}

interface BadgeDetailModalProps {
    badge: UserBadge | null;
    visible: boolean;
    onClose: () => void;
    onSetFeatured?: (badge: UserBadge) => void;
    isFeatured?: boolean;
    canSetFeatured?: boolean;
}

export function BadgeDetailModal({
    badge,
    visible,
    onClose,
    onSetFeatured,
    isFeatured,
    canSetFeatured,
}: BadgeDetailModalProps) {
    const { t } = useT();
    if (!badge) return null;

    const isTiered = badge.family.kind === 'tiered' && badge.family.tierLabels;

    const heroMetal =
        badge.family.kind === 'welcome'
            ? 'welcome'
            : badge.family.kind === 'legendary'
              ? 'legendary'
              : badge.family.kind === 'elite'
                ? 'elite'
                : badge.unlocked
                  ? badge.metal
                  : 'locked';

    const heroDimmed = !badge.unlocked && badge.family.kind !== 'tiered';

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.modalOverlay} onPress={onClose}>
                <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
                        <Text style={styles.modalTitle}>{badge.family.nombre}</Text>

                        <View style={[styles.heroTrophy, heroDimmed && styles.heroDimmed]}>
                            <TrophyIcon shape={badge.family.shape} metal={heroMetal} size="modal" />
                        </View>

                        <Text style={[styles.modalStatus, badge.unlocked && styles.modalStatusUnlocked]}>
                            {badge.unlocked ? t('profile.badgeUnlocked') : t('profile.badgeLocked')}
                        </Text>

                        <Text style={styles.modalDesc}>
                            {badge.family.welcomeText
                                ?? badge.family.eliteText
                                ?? badge.family.legendaryText
                                ?? badge.progressText}
                        </Text>

                        {isTiered && (
                            <View style={styles.tierSection}>
                                <Text style={styles.tierHeading}>{t('profile.badgeTierPreview')}</Text>
                                <Text style={styles.tierSub}>{t('profile.badgeTierHint')}</Text>
                                <View style={styles.tierRow}>
                                    {([1, 2, 3] as const).map((lvl) => {
                                        const metal = metalForPreview(lvl);
                                        const label = badge.family.tierLabels![
                                            lvl === 1 ? 'bronze' : lvl === 2 ? 'silver' : 'gold'
                                        ];
                                        const achieved = badge.level >= lvl;
                                        return (
                                            <View
                                                key={lvl}
                                                style={[styles.tierItem, achieved && styles.tierItemAchieved]}
                                            >
                                                <TrophyIcon
                                                    shape={badge.family.shape}
                                                    metal={metal}
                                                    size="preview"
                                                />
                                                <Text style={[styles.tierLabel, achieved && styles.tierLabelActive]}>
                                                    {lvl === 1 ? 'Bronce' : lvl === 2 ? 'Plata' : 'Oro'}
                                                </Text>
                                                <Text style={styles.tierReq}>{label}</Text>
                                                {badge.level === lvl && (
                                                    <View style={styles.currentPill}>
                                                        <Text style={styles.currentPillText}>{t('profile.badgeCurrent')}</Text>
                                                    </View>
                                                )}
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        )}

                        {badge.family.kind === 'tiered' && !badge.unlocked && (
                            <Text style={styles.progressHint}>{badge.progressText}</Text>
                        )}

                        {canSetFeatured && badge.unlocked && onSetFeatured ? (
                            <TouchableOpacity
                                style={[styles.featuredBtn, isFeatured && styles.featuredBtnActive]}
                                onPress={() => onSetFeatured(badge)}
                            >
                                <Ionicons
                                    name={isFeatured ? 'star' : 'star-outline'}
                                    size={18}
                                    color={isFeatured ? '#FFF' : '#2563EB'}
                                />
                                <Text style={[styles.featuredBtnText, isFeatured && styles.featuredBtnTextActive]}>
                                    {isFeatured ? t('profile.featuredBadgeActive') : t('profile.setFeaturedBadge')}
                                </Text>
                            </TouchableOpacity>
                        ) : null}

                        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                            <Text style={styles.closeBtnText}>{t('common.back')}</Text>
                        </TouchableOpacity>
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    iconRoot: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
    glow: { position: 'absolute', borderRadius: 999, opacity: 0.75 },

    starMedal: {
        borderRadius: 999,
        borderWidth: 2,
        transform: [{ rotate: '22deg' }],
        alignItems: 'center',
        justifyContent: 'center',
    },
    starInner: {
        width: '42%',
        height: '42%',
        borderRadius: 999,
        borderWidth: 2,
        opacity: 0.65,
    },
    ribbonLeft: { position: 'absolute', bottom: -4, left: '22%', transform: [{ rotate: '-18deg' }], borderRadius: 3 },
    ribbonRight: { position: 'absolute', bottom: -4, right: '22%', transform: [{ rotate: '18deg' }], borderRadius: 3 },

    roundMedal: { borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    roundRing: { width: '55%', height: '55%', borderRadius: 999, borderWidth: 2, opacity: 0.5 },
    vRibbon: {
        position: 'absolute',
        bottom: -2,
        left: '34%',
        borderLeftWidth: 0,
        borderRightWidth: 0,
        borderBottomWidth: 18,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        transform: [{ rotate: '-8deg' }],
    },
    vRibbonRight: { left: '48%', transform: [{ rotate: '8deg' }] },

    cupHandle: {
        position: 'absolute',
        top: '18%',
        width: 10,
        borderWidth: 2,
        borderRadius: 8,
    },
    cupHandleL: { left: '8%', borderRightWidth: 0 },
    cupHandleR: { right: '8%', borderLeftWidth: 0 },
    cupBowl: { borderWidth: 2, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
    cupStem: { borderRadius: 2 },
    cupBase: { borderRadius: 4, borderWidth: 2, marginTop: 1 },

    burstStar: {
        borderWidth: 2,
        transform: [{ rotate: '18deg' }],
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    burstCore: { width: '32%', height: '32%', borderRadius: 999, opacity: 0.55 },

    hexagon: {
        borderWidth: 2,
        transform: [{ rotate: '30deg' }],
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hexInner: { width: '45%', height: '45%', borderWidth: 2, borderRadius: 4, transform: [{ rotate: '-30deg' }], opacity: 0.45 },

    shield: {
        borderWidth: 2,
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 22,
        borderBottomRightRadius: 22,
        alignItems: 'center',
        paddingTop: 8,
    },
    shieldChevron: {
        width: 0,
        height: 0,
        borderLeftWidth: 10,
        borderRightWidth: 10,
        borderTopWidth: 14,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        opacity: 0.55,
    },

    blockTop: { borderWidth: 2, borderRadius: 4 },
    blockBase: { borderRadius: 3, marginTop: 2 },

    wreathWrap: { alignItems: 'center', justifyContent: 'center' },
    wreathRing: {
        width: '72%',
        height: '72%',
        borderRadius: 999,
        borderWidth: 5,
        position: 'absolute',
    },
    wreathLeaf: {
        position: 'absolute',
        width: 8,
        height: 12,
        borderRadius: 6,
    },

    heartWrap: { alignItems: 'center', justifyContent: 'center' },
    heartLobe: {
        position: 'absolute',
        top: 0,
        width: '38%',
        height: '42%',
        borderRadius: 999,
        borderWidth: 2,
    },
    heartLobeL: { left: '14%', transform: [{ rotate: '-38deg' }] },
    heartLobeR: { right: '14%', transform: [{ rotate: '38deg' }] },
    heartPoint: {
        position: 'absolute',
        bottom: 2,
        width: 0,
        height: 0,
        borderLeftWidth: 18,
        borderRightWidth: 18,
        borderBottomWidth: 22,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
    },

    nodesWrap: { alignItems: 'center', justifyContent: 'center' },
    nodeCenter: { width: '34%', height: '34%', borderRadius: 999, borderWidth: 2 },
    nodeOrbit: { position: 'absolute', alignItems: 'center' },
    nodeDot: { width: 8, height: 8, borderRadius: 4 },
    nodeLine: { width: 2, height: 10, marginTop: 1 },

    compassWrap: { alignItems: 'center', justifyContent: 'center' },
    compassDiamond: {
        width: '78%',
        height: '78%',
        transform: [{ rotate: '45deg' }],
        borderRadius: 6,
        borderWidth: 2,
    },
    compassNeedleN: {
        position: 'absolute',
        top: '10%',
        width: 0,
        height: 0,
        borderLeftWidth: 7,
        borderRightWidth: 7,
        borderBottomWidth: 16,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
    },
    compassNeedleS: {
        position: 'absolute',
        bottom: '10%',
        width: 0,
        height: 0,
        borderLeftWidth: 5,
        borderRightWidth: 5,
        borderTopWidth: 12,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
    },
    compassNeedleE: {
        position: 'absolute',
        right: '12%',
        width: 0,
        height: 0,
        borderTopWidth: 5,
        borderBottomWidth: 5,
        borderLeftWidth: 10,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
    },
    compassNeedleW: {
        position: 'absolute',
        left: '12%',
        width: 0,
        height: 0,
        borderTopWidth: 5,
        borderBottomWidth: 5,
        borderRightWidth: 10,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
    },
    compassHub: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },

    crownSpikes: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3 },
    crownSpike: { flex: 1, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    crownBand: { borderWidth: 2, borderRadius: 4, marginTop: -1 },

    tile: { width: 88, alignItems: 'center', gap: 6 },
    tilePress: { width: 88 },
    tileName: { fontSize: 11, fontWeight: '700', color: INK, textAlign: 'center', lineHeight: 14 },
    tileNameLocked: { color: '#94A3B8' },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15,42,74,0.5)',
        justifyContent: 'center',
        padding: 20,
    },
    modalSheet: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        maxHeight: '88%',
        overflow: 'hidden',
    },
    modalScroll: { padding: 24, alignItems: 'center' },
    modalTitle: { fontSize: 22, fontWeight: '900', color: INK, marginBottom: 16, textAlign: 'center' },
    heroTrophy: { marginVertical: 8 },
    heroDimmed: { opacity: 0.55 },
    modalStatus: { fontSize: 13, fontWeight: '700', color: '#94A3B8', marginTop: 8 },
    modalStatusUnlocked: { color: '#22C55E' },
    modalDesc: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginTop: 10 },
    tierSection: { width: '100%', marginTop: 22 },
    tierHeading: {
        fontSize: 12,
        fontWeight: '800',
        color: '#94A3B8',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        textAlign: 'center',
    },
    tierSub: { fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 4, marginBottom: 14 },
    tierRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    tierItem: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    tierItemAchieved: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
    tierLabel: { fontSize: 12, fontWeight: '800', color: '#94A3B8', marginTop: 6 },
    tierLabelActive: { color: INK },
    tierReq: { fontSize: 9, color: MUTED, textAlign: 'center', marginTop: 4, lineHeight: 12 },
    currentPill: {
        marginTop: 6,
        backgroundColor: '#2563EB',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
    },
    currentPillText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
    progressHint: { marginTop: 14, fontSize: 13, color: MUTED, fontWeight: '600' },
    featuredBtn: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 14,
        backgroundColor: '#EFF6FF',
        borderWidth: 1.5,
        borderColor: '#BFDBFE',
    },
    featuredBtnActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
    featuredBtnText: { color: '#2563EB', fontWeight: '800', fontSize: 14 },
    featuredBtnTextActive: { color: '#FFF' },
    closeBtn: {
        marginTop: 20,
        paddingVertical: 12,
        paddingHorizontal: 28,
        borderRadius: 14,
        backgroundColor: '#EFF6FF',
    },
    closeBtnText: { color: '#2563EB', fontWeight: '800', fontSize: 15 },
});
