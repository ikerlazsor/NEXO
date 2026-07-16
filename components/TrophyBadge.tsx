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
    { colors: [string, string, ...string[]]; rim: string; glow?: string }
> = {
    locked: { colors: ['#E2E8F0', '#94A3B8'], rim: '#64748B' },
    bronze: { colors: ['#F0C987', '#CD7F32', '#8B5A2B'], rim: '#6B4423' },
    silver: { colors: ['#F5F5F5', '#C0C0C0', '#808080'], rim: '#5C5C5C' },
    gold: { colors: ['#FFF4B8', '#FFD700', '#DAA520'], rim: '#B8860B', glow: '#FFD70044' },
    elite: { colors: ['#C4B5FD', '#818CF8', '#6366F1'], rim: '#4338CA', glow: '#6366F144' },
    legendary: { colors: ['#E0F2FE', '#7DD3FC', '#38BDF8', '#0284C7'], rim: '#0369A1', glow: '#38BDF866' },
    welcome: { colors: ['#93C5FD', '#4DA6FF', '#2563EB'], rim: '#1D4ED8', glow: '#2563EB55' },
};

interface TrophyProps {
    shape: BadgeShape;
    metal: TrophyMetal;
    size?: 'grid' | 'modal' | 'preview';
}

export function TrophyIcon({ shape, metal, size = 'grid' }: TrophyProps) {
    const dims = size === 'modal' ? { w: 88, h: 108 } : size === 'preview' ? { w: 56, h: 70 } : { w: 52, h: 64 };
    const palette = METAL_PALETTE[metal];
    const locked = metal === 'locked';

    return (
        <View style={[styles.trophyWrap, { width: dims.w, height: dims.h }]}>
            {!locked && palette.glow && (
                <View style={[styles.glow, { backgroundColor: palette.glow, width: dims.w * 1.1, height: dims.h * 0.5 }]} />
            )}
            <LinearGradient
                colors={palette.colors}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={[styles.trophyBody, { width: dims.w * 0.72, borderColor: palette.rim }]}
            >
                <ShapeDecoration shape={shape} metal={metal} width={dims.w * 0.72} />
                {!locked && <View style={styles.cupShine} />}
            </LinearGradient>
            <View style={[styles.stem, { width: dims.w * 0.14, height: dims.h * 0.18, backgroundColor: palette.rim }]} />
            <LinearGradient
                colors={locked ? (['#CBD5E1', '#94A3B8'] as [string, string]) : ([palette.colors[0], palette.rim] as [string, string])}
                style={[styles.base, { width: dims.w * 0.88, height: dims.h * 0.12, borderColor: palette.rim }]}
            />
            {shape === 'crown' && !locked && (
                <View style={[styles.crownTop, { top: -dims.h * 0.08 }]}>
                    <Ionicons name="diamond" size={dims.w * 0.22} color="#FFF" />
                </View>
            )}
        </View>
    );
}

function ShapeDecoration({ shape, metal, width }: { shape: BadgeShape; metal: TrophyMetal; width: number }) {
    const iconColor = metal === 'locked' ? '#94A3B8' : '#FFFFFF';
    const iconSize = width * 0.32;

    const iconMap: Partial<Record<BadgeShape, keyof typeof Ionicons.glyphMap>> = {
        welcome: 'sparkles',
        gourmet: 'restaurant',
        sport: 'football',
        party: 'musical-notes',
        scholar: 'school',
        grace: 'heart',
        pillar: 'business',
        laurel: 'time',
        heart: 'heart-circle',
        network: 'git-network',
        compass: 'compass',
        crown: 'star',
    };

    return (
        <View style={styles.emblem}>
            {shape === 'sport' && <View style={styles.handleLeft} />}
            {shape === 'sport' && <View style={styles.handleRight} />}
            {shape === 'grace' && <View style={[styles.graceWing, styles.graceWingLeft]} />}
            {shape === 'grace' && <View style={[styles.graceWing, styles.graceWingRight]} />}
            {shape === 'welcome' && (
                <>
                    <View style={[styles.welcomeRay, { transform: [{ rotate: '-28deg' }] }]} />
                    <View style={[styles.welcomeRay, { transform: [{ rotate: '28deg' }] }]} />
                </>
            )}
            {shape === 'crown' && metal === 'legendary' && <View style={styles.legendRing} />}
            <Ionicons name={iconMap[shape] ?? 'trophy'} size={iconSize} color={iconColor} />
        </View>
    );
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
}

export function BadgeDetailModal({ badge, visible, onClose }: BadgeDetailModalProps) {
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
    trophyWrap: { alignItems: 'center', justifyContent: 'flex-end', position: 'relative' },
    glow: {
        position: 'absolute',
        bottom: '18%',
        borderRadius: 999,
        opacity: 0.85,
    },
    trophyBody: {
        height: '58%',
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    cupShine: {
        position: 'absolute',
        top: 4,
        left: 6,
        width: '35%',
        height: '45%',
        backgroundColor: 'rgba(255,255,255,0.35)',
        borderRadius: 8,
        transform: [{ rotate: '-18deg' }],
    },
    stem: { borderRadius: 2 },
    base: {
        borderRadius: 6,
        borderWidth: 2,
        marginTop: 1,
    },
    crownTop: { position: 'absolute', alignSelf: 'center' },
    emblem: { alignItems: 'center', justifyContent: 'center' },
    handleLeft: {
        position: 'absolute',
        left: -8,
        width: 8,
        height: 20,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.5)',
        borderRightWidth: 0,
        borderTopLeftRadius: 8,
        borderBottomLeftRadius: 8,
    },
    handleRight: {
        position: 'absolute',
        right: -8,
        width: 8,
        height: 20,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.5)',
        borderLeftWidth: 0,
        borderTopRightRadius: 8,
        borderBottomRightRadius: 8,
    },
    graceWing: {
        position: 'absolute',
        top: 8,
        width: 10,
        height: 18,
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderRadius: 10,
    },
    graceWingLeft: { left: -4, transform: [{ rotate: '-25deg' }] },
    graceWingRight: { right: -4, transform: [{ rotate: '25deg' }] },
    welcomeRay: {
        position: 'absolute',
        top: -6,
        width: 3,
        height: 14,
        backgroundColor: 'rgba(255,255,255,0.6)',
        borderRadius: 2,
    },
    legendRing: {
        position: 'absolute',
        width: 46,
        height: 46,
        borderRadius: 23,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.45)',
    },
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
    closeBtn: {
        marginTop: 20,
        paddingVertical: 12,
        paddingHorizontal: 28,
        borderRadius: 14,
        backgroundColor: '#EFF6FF',
    },
    closeBtnText: { color: '#2563EB', fontWeight: '800', fontSize: 15 },
});
