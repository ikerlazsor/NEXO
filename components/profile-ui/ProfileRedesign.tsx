import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import {
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../ProfileAvatar';
import { PlanImage } from '../PlanImage';
import { renderRatingStars } from '../../lib/profileRating';
import { formatRatingScore } from '../../lib/stats';
import { resolvePlanImageSource } from '../../lib/sports';
import { resolveProfileCoverSource } from '../../lib/profileCover';
import { countryCodeToFlagEmoji } from '../../lib/countryFlags';
import { getInterestAccent, getInterestIcon, INTEREST_VISIBLE_MAX } from '../../lib/profileInterests';
import { stripPlanTitleSuffix } from '../../lib/planDisplay';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../../lib/planDetailCache';
import { prefetchRemoteImages } from '../../lib/prefetchCovers';
import {
    formatCompactCount,
    formatProfilePlanWhen,
    type ProfileMiniUser,
    type PublicAttendedPlan,
} from '../../lib/profileSocial';
import {
    organizerInstagramUrl,
    organizerWebUrl,
    organizerWhatsappUrl,
    type OrganizerMedia,
    type OrganizerUpcomingPlan,
} from '../../lib/organizer';
import { TranslatedText } from '../TranslatedText';
import type { Lang } from '../../lib/i18n';
import { theme, type ThemeColors } from '../../theme';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';

export const PERSON_GREEN = '#22C55E';
export const PERSON_GREEN_DARK = '#16A34A';
export const ORG_PURPLE = '#2563EB';
export const ORG_PURPLE_DARK = '#1D4ED8';
export const INK = '#0F172A';
export const MUTED = '#64748B';
export const PAGE_BG = '#F7F8FB';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function FrostedIconButton({
    icon,
    onPress,
    accessibilityLabel,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    accessibilityLabel: string;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    return (
        <TouchableOpacity
            onPress={onPress}
            style={styles.frostedBtn}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            hitSlop={6}
        >
            <Ionicons name={icon} size={20} color="#0F172A" />
        </TouchableOpacity>
    );
}

/** Back fijo encima del scroll (como detalle de plan). */
export function ProfileStickyBack({
    onBack,
    backLabel,
}: {
    onBack: () => void;
    backLabel: string;
}) {
    const insets = useSafeAreaInsets();
    return (
        <View
            pointerEvents="box-none"
            style={[
                stickyBackStyles.bar,
                { paddingTop: Math.max(insets.top, 12) + 4, paddingLeft: 14 },
            ]}
        >
            <FrostedIconButton icon="chevron-back" onPress={onBack} accessibilityLabel={backLabel} />
        </View>
    );
}

const stickyBackStyles = StyleSheet.create({
    bar: {
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 40,
        elevation: 12,
    },
});

export function GalleryThumb({
    item,
    onPress,
    size = 92,
    children,
}: {
    item: OrganizerMedia;
    onPress?: () => void;
    size?: number;
    children?: ReactNode;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    const cover = item.kind === 'video' ? (item.thumb || null) : item.url;
    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={!onPress}
            activeOpacity={0.9}
            style={{ width: size, height: size, borderRadius: 14, overflow: 'hidden', backgroundColor: '#0F172A', marginRight: 12 }}
        >
            {cover ? (
                <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
            {item.kind === 'video' ? (
                <View style={styles.galleryPlay}>
                    <Ionicons name="play" size={18} color="#FFF" />
                </View>
            ) : null}
            {children}
        </TouchableOpacity>
    );
}

export function ProfileHero({
    coverUrl,
    avatarUrl,
    name,
    age,
    flagCode,
    placeLabel,
    instagram,
    verified,
    overlay,
    variant,
    onBack,
    onMore,
    onCoverPress,
    coverEdit,
    topRight,
    backLabel,
    moreLabel,
    /** Si true, el back va fuera del ScrollView (ProfileStickyBack). */
    stickyBack = false,
}: {
    coverUrl?: string | null;
    avatarUrl?: string | null;
    name: string;
    /** Edad visible (ya filtrada por privacidad). */
    age?: number | null;
    /** Código ISO nacionalidad (bandera). */
    flagCode?: string | null;
    /** Ciudad, País aproximados. */
    placeLabel?: string | null;
    /** Handle de Instagram sin @. */
    instagram?: string | null;
    verified?: boolean;
    overlay?: ReactNode;
    variant: 'person' | 'organizer';
    onBack: () => void;
    onMore?: () => void;
    onCoverPress?: () => void;
    coverEdit?: boolean;
    topRight?: ReactNode;
    backLabel: string;
    moreLabel?: string;
    stickyBack?: boolean;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    const insets = useSafeAreaInsets();
    const { height, width } = useWindowDimensions();
    const heroH =
        variant === 'organizer'
            ? Math.round(height * 0.28)
            : Math.round(height * 0.6);
    const source = resolveProfileCoverSource(coverUrl, avatarUrl, {
        allowAvatarFallback: variant === 'person',
    });

    const showAge = typeof age === 'number' && age > 0;
    const flagEmoji = countryCodeToFlagEmoji(flagCode);
    const place = (placeLabel || '').trim();
    const ig = (instagram || '').trim().replace(/^@+/, '');
    const showMeta = !!place || !!flagEmoji || showAge || !!ig;

    return (
        <View style={[styles.heroShell, { width }]}>
            <Pressable
                onPress={onCoverPress}
                disabled={!onCoverPress}
                style={[styles.heroClip, { height: heroH }]}
            >
                {source ? (
                    <Image
                        source={source}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        contentPosition="center"
                        cachePolicy="memory-disk"
                        recyclingKey={coverUrl || avatarUrl || name}
                    />
                ) : (
                    <LinearGradient
                        colors={
                            variant === 'organizer'
                                ? ['#1E3A8A', '#2563EB', '#93C5FD']
                                : ['#0F766E', '#22C55E', '#86EFAC']
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                    />
                )}
                <LinearGradient
                    colors={['rgba(15,23,42,0.05)', 'rgba(15,23,42,0.18)', 'rgba(15,23,42,0.78)']}
                    locations={[0.35, 0.62, 1]}
                    style={StyleSheet.absoluteFill}
                />
                <View style={[styles.heroTopRow, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
                    {stickyBack ? (
                        <View style={styles.frostedBtnGhost} />
                    ) : (
                        <FrostedIconButton icon="chevron-back" onPress={onBack} accessibilityLabel={backLabel} />
                    )}
                    {topRight ?? (
                        onMore ? (
                            <FrostedIconButton
                                icon="ellipsis-horizontal"
                                onPress={onMore}
                                accessibilityLabel={moreLabel || ''}
                            />
                        ) : (
                            <View style={styles.frostedBtnGhost} />
                        )
                    )}
                </View>
                {coverEdit ? (
                    <View style={styles.coverEditChip} pointerEvents="none">
                        <Ionicons name="camera" size={14} color="#FFF" />
                    </View>
                ) : null}
                {variant === 'person' ? (
                    <View style={styles.heroCopy}>
                        <View style={styles.nameRow}>
                            <Text style={styles.heroName} numberOfLines={1}>
                                {name}
                            </Text>
                            {verified ? (
                                <Ionicons name="checkmark-circle" size={24} color="#60A5FA" />
                            ) : null}
                        </View>
                        {showMeta ? (
                            <View style={styles.heroMetaRow}>
                                {place ? (
                                    <View style={[styles.heroMetaChip, styles.heroMetaChipFlex]}>
                                        <Ionicons name="location-sharp" size={14} color="#FFF" />
                                        <Text style={styles.heroMetaText} numberOfLines={1}>
                                            {place}
                                        </Text>
                                    </View>
                                ) : null}
                                {place && (flagEmoji || showAge || ig) ? (
                                    <Text style={styles.heroMetaSep}>|</Text>
                                ) : null}
                                {flagEmoji ? (
                                    <View style={styles.heroMetaChip}>
                                        <Text style={styles.heroMetaFlag}>{flagEmoji}</Text>
                                    </View>
                                ) : null}
                                {flagEmoji && (showAge || ig) ? (
                                    <Text style={styles.heroMetaSep}>|</Text>
                                ) : null}
                                {showAge ? (
                                    <View style={styles.heroMetaChip}>
                                        <Text style={styles.heroMetaTextTight}>{age}</Text>
                                    </View>
                                ) : null}
                                {showAge && ig ? <Text style={styles.heroMetaSep}>|</Text> : null}
                                {ig ? (
                                    <View style={[styles.heroMetaChip, styles.heroMetaChipFlex]}>
                                        <Ionicons name="logo-instagram" size={14} color="#FFF" />
                                        <Text style={styles.heroMetaText} numberOfLines={1}>
                                            {ig}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
                        {overlay}
                    </View>
                ) : null}
            </Pressable>
        </View>
    );
}

export function MutualAvatarsRow({
    people,
    label,
    tone = 'light',
}: {
    people: ProfileMiniUser[];
    label: string;
    tone?: 'light' | 'dark';
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    if (!people.length) return null;
    const light = tone === 'light';
    return (
        <View style={styles.mutualRow}>
            <View style={styles.mutualStack}>
                {people.slice(0, 4).map((person, index) => (
                    <View
                        key={person.id}
                        style={[
                            styles.mutualAvatar,
                            { marginLeft: index === 0 ? 0 : -8, zIndex: 4 - index },
                            !light && styles.mutualAvatarDark,
                        ]}
                    >
                        <ProfileAvatar uri={person.avatar_url} name={person.nombre} size={22} recyclingKey={person.id} />
                    </View>
                ))}
            </View>
            <Text style={[styles.mutualLabel, !light && styles.mutualLabelDark]} numberOfLines={1}>{label}</Text>
        </View>
    );
}

export function FollowersAvatarsRow({
    people,
    total,
}: {
    people: ProfileMiniUser[];
    total: number;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    const shown = people.slice(0, 5);
    const extra = Math.max(0, total - shown.length);
    if (total <= 0 && !shown.length) return null;
    return (
        <View style={styles.followRow}>
            <View style={styles.mutualStack}>
                {shown.map((person, index) => (
                    <View
                        key={person.id}
                        style={[
                            styles.mutualAvatar,
                            styles.mutualAvatarDark,
                            { marginLeft: index === 0 ? 0 : -10, zIndex: 6 - index },
                        ]}
                    >
                        <ProfileAvatar uri={person.avatar_url} name={person.nombre} size={26} recyclingKey={person.id} />
                    </View>
                ))}
                {extra > 0 ? (
                    <View style={[styles.followExtra, { marginLeft: shown.length ? -10 : 0, zIndex: 0 }]}>
                        <Text style={styles.followExtraText}>+{extra}</Text>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

export function ProfileStatsCard({
    leftValue,
    leftLabel,
    rating,
    reviewsLabel,
    rightValue,
    rightLabel,
    leftBadge = 0,
    rightBadge = 0,
    onLeftPress,
    onRightPress,
    overlapHero = true,
    middleMode = 'stars',
    repeatPct = null,
    middleText,
}: {
    leftValue: string | number;
    leftLabel: string;
    rating: number;
    reviewsLabel: string;
    rightValue: string | number;
    rightLabel: string;
    leftBadge?: number;
    rightBadge?: number;
    onLeftPress?: () => void;
    onRightPress?: () => void;
    overlapHero?: boolean;
    middleMode?: 'stars' | 'repeat';
    repeatPct?: number | null;
    middleText?: string;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    return (
        <View style={[styles.statsCard, !overlapHero && styles.statsCardBelow]}>
            <Pressable style={styles.statCol} onPress={onLeftPress} disabled={!onLeftPress}>
                <View style={styles.statNumberWrap}>
                    <Text style={styles.statNumber} numberOfLines={1}>
                        {leftValue}
                    </Text>
                    {leftBadge > 0 ? (
                        <View style={styles.statBadge}>
                            <Text style={styles.statBadgeText}>{leftBadge > 9 ? '9+' : leftBadge}</Text>
                        </View>
                    ) : null}
                </View>
                <Text style={styles.statLabel} numberOfLines={2}>
                    {leftLabel}
                </Text>
            </Pressable>
            <View style={styles.statRule} />
            <View style={styles.statCol}>
                {middleMode === 'repeat' ? (
                    <>
                        <Text style={styles.statNumber} numberOfLines={1}>
                            {middleText ?? (repeatPct == null ? '—' : `${repeatPct}%`)}
                        </Text>
                        <Text style={styles.statLabel} numberOfLines={2}>
                            {reviewsLabel}
                        </Text>
                    </>
                ) : (
                    <>
                        <View style={styles.ratingHead}>
                            <Text style={styles.statNumber} numberOfLines={1}>
                                {formatRatingScore(rating)}
                            </Text>
                            <View style={styles.stars}>{renderRatingStars(rating, 17)}</View>
                        </View>
                        <Text style={styles.statLabel} numberOfLines={2}>
                            {reviewsLabel}
                        </Text>
                    </>
                )}
            </View>
            <View style={styles.statRule} />
            <Pressable style={styles.statCol} onPress={onRightPress} disabled={!onRightPress}>
                <View style={styles.statNumberWrap}>
                    <Text style={styles.statNumber} numberOfLines={1}>
                        {rightValue}
                    </Text>
                    {rightBadge > 0 ? (
                        <View style={styles.statBadge}>
                            <Text style={styles.statBadgeText}>{rightBadge > 9 ? '9+' : rightBadge}</Text>
                        </View>
                    ) : null}
                </View>
                <Text style={styles.statLabel} numberOfLines={2}>
                    {rightLabel}
                </Text>
            </Pressable>
        </View>
    );
}

export function ProfileInfoChips({ items }: { items: Array<{ key: string; label: string; icon?: keyof typeof Ionicons.glyphMap }> }) {
    const styles = useThemedStyles(createProfileUiStyles);
    const { colors } = useAppTheme();
    if (!items.length) return null;
    return (
        <View style={styles.chipWrap}>
            {items.map((item) => (
                <View key={item.key} style={styles.infoChip}>
                    {item.icon ? <Ionicons name={item.icon} size={13} color={colors.text} /> : null}
                    <Text style={styles.infoChipText} numberOfLines={1}>{item.label}</Text>
                </View>
            ))}
        </View>
    );
}

export function ProfileDualActions({
    primaryLabel,
    primaryIcon,
    onPrimary,
    primaryTone,
    primaryActive,
    secondaryLabel,
    secondaryIcon,
    onSecondary,
    extra,
}: {
    primaryLabel: string;
    primaryIcon: keyof typeof Ionicons.glyphMap;
    onPrimary?: () => void;
    primaryTone: 'green' | 'purple';
    primaryActive?: boolean;
    secondaryLabel: string;
    secondaryIcon: keyof typeof Ionicons.glyphMap;
    onSecondary?: () => void;
    extra?: ReactNode;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    const bg = primaryTone === 'purple'
        ? (primaryActive ? '#93C5FD' : ORG_PURPLE)
        : (primaryActive ? '#6EE7B7' : PERSON_GREEN);
    const color = primaryActive
        ? (primaryTone === 'purple' ? '#1E40AF' : '#047857')
        : '#FFF';
    return (
        <View style={styles.actionsCol}>
            <View style={styles.actionsRow}>
                {onPrimary ? (
                    <TouchableOpacity
                        style={[
                            styles.primaryBtn,
                            { backgroundColor: bg },
                            primaryActive && {
                                borderWidth: 2,
                                borderColor: primaryTone === 'purple' ? '#3B82F6' : '#10B981',
                            },
                        ]}
                        onPress={onPrimary}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel={primaryLabel}
                    >
                        <Ionicons name={primaryIcon} size={16} color={color} />
                        <Text style={[styles.primaryBtnText, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{primaryLabel}</Text>
                    </TouchableOpacity>
                ) : null}
                {onSecondary ? (
                    <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={onSecondary}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel={secondaryLabel}
                    >
                        <Ionicons name={secondaryIcon} size={16} color={INK} />
                        <Text style={styles.secondaryBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{secondaryLabel}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
            {extra}
        </View>
    );
}

export function ProfileSection({
    title,
    actionLabel,
    onAction,
    children,
}: {
    title: string;
    actionLabel?: string;
    onAction?: () => void;
    children: ReactNode;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    return (
        <View style={styles.section}>
            <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {actionLabel && onAction ? (
                    <TouchableOpacity onPress={onAction} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.sectionAction}>{actionLabel}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
            {children}
        </View>
    );
}

export function InterestTiles({
    tags,
    genero,
    t,
}: {
    tags: string[];
    genero?: string | null;
    t: Translate;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    if (!tags.length) return null;
    const extra = Math.max(0, tags.length - INTEREST_VISIBLE_MAX);
    const visible = tags.slice(0, INTEREST_VISIBLE_MAX);
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.interestRow}>
            {visible.map((tag) => {
                const feminine = genero === 'femenino' ? t(`personality.${tag}.f`) : '';
                const label =
                    feminine && feminine !== `personality.${tag}.f`
                        ? feminine
                        : t(`personality.${tag}`) !== `personality.${tag}`
                          ? t(`personality.${tag}`)
                          : tag;
                const accent = getInterestAccent(tag);
                return (
                    <View key={tag} style={styles.interestTile}>
                        <View
                            style={[
                                styles.interestIcon,
                                { backgroundColor: accent.bg, borderColor: accent.border },
                            ]}
                        >
                            <Ionicons name={getInterestIcon(tag)} size={24} color={accent.icon} />
                        </View>
                        <Text style={styles.interestLabel} numberOfLines={1}>{label}</Text>
                    </View>
                );
            })}
            {extra > 0 ? (
                <View style={styles.interestTile}>
                    <View style={[styles.interestIcon, styles.interestMoreIcon]}>
                        <Text style={styles.morePlus}>+{extra}</Text>
                    </View>
                    <Text style={styles.interestLabel}>{t('profilev.more')}</Text>
                </View>
            ) : null}
        </ScrollView>
    );
}

export function AttendedPlansRow({
    plans,
    emptyLabel,
    lang,
    onPressPlan,
    showWhen = false,
}: {
    plans: PublicAttendedPlan[];
    emptyLabel: string;
    lang: Lang;
    onPressPlan: (id: string) => void;
    showWhen?: boolean;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    if (!plans.length) {
        return (
            <View style={styles.emptyPlans}>
                <Text style={styles.emptyPlansText}>{emptyLabel}</Text>
            </View>
        );
    }
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attendedRow}>
            {plans.map((plan) => {
                const when = showWhen ? formatProfilePlanWhen(plan.fecha_evento, lang) : '';
                return (
                    <TouchableOpacity
                        key={plan.id}
                        style={styles.attendedCard}
                        onPressIn={() => {
                            seedPlanDetailFromFeed(plan as unknown as Record<string, unknown>);
                            prefetchPlanDetail(plan.id);
                            prefetchRemoteImages([plan.imagen_url], 1);
                        }}
                        onPress={() => onPressPlan(plan.id)}
                        activeOpacity={0.9}
                    >
                        <PlanImage
                            source={resolvePlanImageSource(plan.imagen_url)}
                            style={styles.attendedImage}
                            recyclingKey={plan.id}
                            thumbWidth={180}
                        />
                        <Text style={styles.attendedTitle} numberOfLines={1}>{stripPlanTitleSuffix(plan.titulo)}</Text>
                        {when ? (
                            <Text style={styles.attendedMeta} numberOfLines={1}>{when}</Text>
                        ) : null}
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    );
}

export function OrganizerUpcomingGrid({
    plans,
    emptyLabel,
    lang,
    onPressPlan,
}: {
    plans: OrganizerUpcomingPlan[];
    emptyLabel: string;
    lang: Lang;
    onPressPlan: (id: string) => void;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    if (!plans.length) {
        return (
            <View style={styles.emptyPlans}>
                <Text style={styles.emptyPlansText}>{emptyLabel}</Text>
            </View>
        );
    }
    return (
        <View style={styles.grid}>
            {plans.map((plan) => {
                const cap =
                    plan.maximo_participantes != null
                        ? `${plan.ocupadas}/${plan.maximo_participantes}`
                        : null;
                return (
                    <TouchableOpacity
                        key={plan.id}
                        style={styles.gridCard}
                        onPressIn={() => {
                            seedPlanDetailFromFeed(plan as unknown as Record<string, unknown>);
                            prefetchPlanDetail(plan.id);
                            prefetchRemoteImages([plan.imagen_url], 1);
                        }}
                        onPress={() => onPressPlan(plan.id)}
                        activeOpacity={0.9}
                    >
                        <PlanImage
                            source={resolvePlanImageSource(plan.imagen_url)}
                            style={styles.gridImage}
                            recyclingKey={plan.id}
                            thumbWidth={200}
                        />
                        <View style={styles.gridBody}>
                            <Text style={styles.gridTitle} numberOfLines={1}>{stripPlanTitleSuffix(plan.titulo)}</Text>
                            <Text style={styles.gridMeta} numberOfLines={1}>
                                {formatProfilePlanWhen(plan.fecha_evento, lang) || plan.nombre_ubicacion || ' '}
                            </Text>
                            {cap ? <Text style={styles.gridCap}>{cap}</Text> : null}
                        </View>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

export function CategoryPills({
    keys,
    t,
}: {
    keys: string[];
    t: Translate;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    if (!keys.length) return null;
    const extra = Math.max(0, keys.length - 6);
    const visible = keys.slice(0, 6);
    return (
        <View style={styles.chipWrap}>
            {visible.map((key) => {
                const i18nKey = `organizer.cat.${key}`;
                const label = t(i18nKey) !== i18nKey ? t(i18nKey) : t(`organizer.type.${key}`) !== `organizer.type.${key}` ? t(`organizer.type.${key}`) : key;
                return (
                    <View key={key} style={styles.catChip}>
                        <Text style={styles.catChipText}>{label}</Text>
                    </View>
                );
            })}
            {extra > 0 ? (
                <View style={styles.catChip}>
                    <Text style={styles.catChipText}>+{extra}</Text>
                </View>
            ) : null}
        </View>
    );
}

function webLabel(web?: string | null): string {
    const url = organizerWebUrl(web);
    if (!url) return '';
    try {
        return new URL(url).hostname.replace(/^www\./i, '');
    } catch {
        return web?.trim() || 'Web';
    }
}

function instagramLabel(instagram?: string | null): string {
    const raw = (instagram ?? '').trim().replace(/^@/, '');
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) {
        try {
            const path = new URL(raw).pathname.replace(/\//g, '');
            return path ? `@${path}` : 'Instagram';
        } catch {
            return 'Instagram';
        }
    }
    return `@${raw}`;
}

export function OrganizerIdentity({
    name,
    verifiedLabel,
    description,
    avatar,
    web,
    instagram,
    whatsapp,
    whatsappLabel,
}: {
    name: string;
    verifiedLabel: string;
    description?: string | null;
    avatar?: ReactNode;
    web?: string | null;
    instagram?: string | null;
    whatsapp?: string | null;
    whatsappLabel?: string;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    const webUrl = organizerWebUrl(web);
    const igUrl = organizerInstagramUrl(instagram);
    const waUrl = organizerWhatsappUrl(whatsapp);
    return (
        <View style={styles.orgIdentity}>
            {avatar ? <View style={styles.orgAvatar}>{avatar}</View> : null}
            <View style={styles.orgNameRow}>
                <Text style={styles.orgName} numberOfLines={2}>{name}</Text>
                <Ionicons name="checkmark-circle" size={20} color="#2563EB" />
            </View>
            <View style={styles.orgUserRow}>
                <View style={styles.verifiedPill}>
                    <Text style={styles.verifiedPillText}>{verifiedLabel}</Text>
                </View>
            </View>
            {description ? (
                <TranslatedText text={description} style={styles.orgAbout} numberOfLines={6} />
            ) : null}
            {webUrl || igUrl || waUrl ? (
                <View style={styles.orgLinks}>
                    {webUrl ? (
                        <TouchableOpacity
                            style={styles.orgLink}
                            onPress={() => void Linking.openURL(webUrl)}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="globe-outline" size={15} color={ORG_PURPLE_DARK} />
                            <Text style={styles.orgLinkText} numberOfLines={1}>{webLabel(web)}</Text>
                        </TouchableOpacity>
                    ) : null}
                    {igUrl ? (
                        <TouchableOpacity
                            style={styles.orgLink}
                            onPress={() => void Linking.openURL(igUrl)}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="logo-instagram" size={15} color={ORG_PURPLE_DARK} />
                            <Text style={styles.orgLinkText} numberOfLines={1}>{instagramLabel(instagram)}</Text>
                        </TouchableOpacity>
                    ) : null}
                    {waUrl ? (
                        <TouchableOpacity
                            style={styles.orgLink}
                            onPress={() => void Linking.openURL(waUrl)}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="logo-whatsapp" size={15} color={ORG_PURPLE_DARK} />
                            <Text style={styles.orgLinkText} numberOfLines={1}>
                                {whatsappLabel || 'WhatsApp'}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

export function OrganizerInsightsButton({
    label,
    onPress,
}: {
    label: string;
    onPress: () => void;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    return (
        <TouchableOpacity
            style={styles.insightsBtn}
            onPress={onPress}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <View style={styles.insightsIcon}>
                <Ionicons name="stats-chart" size={16} color={ORG_PURPLE} />
            </View>
            <Text style={styles.insightsBtnText}>{label}</Text>
            <Ionicons name="chevron-forward" size={18} color={ORG_PURPLE} />
        </TouchableOpacity>
    );
}

export function EditProfileButton({
    label,
    onPress,
    tone = 'green',
    showHintBadge = false,
}: {
    label: string;
    onPress: () => void;
    tone?: 'green' | 'purple';
    showHintBadge?: boolean;
}) {
    const styles = useThemedStyles(createProfileUiStyles);
    const bg = tone === 'purple' ? ORG_PURPLE : PERSON_GREEN;
    return (
        <TouchableOpacity
            style={[styles.editProfileBtn, { backgroundColor: bg }]}
            onPress={onPress}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Ionicons name="create-outline" size={18} color="#FFF" />
            <Text style={styles.editProfileBtnText}>{label}</Text>
            {showHintBadge ? <View style={styles.editProfileHintDot} /> : null}
        </TouchableOpacity>
    );
}

export function formatMembers(value: number): string {
    return formatCompactCount(value);
}

function createProfileUiStyles(c: ThemeColors) {
    const INK = c.text;
    const MUTED = c.textMuted;
    return StyleSheet.create({
    heroShell: {
        alignSelf: 'center',
    },
    heroClip: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: 'hidden',
        backgroundColor: '#111827',
    },
    heroTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
    },
    frostedBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.92)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.7)',
    },
    frostedBtnGhost: { width: 40, height: 40 },
    coverEditChip: {
        position: 'absolute',
        right: 16,
        bottom: 88,
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: 'rgba(15,23,42,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroCopy: {
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 44,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    heroName: {
        flexShrink: 1,
        color: '#FFF',
        fontSize: 31,
        lineHeight: 37,
        fontWeight: '800',
        letterSpacing: -0.4,
    },
    heroMetaRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: 6,
        maxWidth: '100%',
        paddingRight: 4,
    },
    heroMetaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
    },
    heroMetaChipFlex: {
        flexShrink: 1,
        minWidth: 0,
    },
    heroMetaSep: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        fontWeight: '800',
        flexShrink: 0,
    },
    heroMetaText: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: 0.1,
        flexShrink: 1,
        textShadowColor: 'rgba(0,0,0,0.45)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    heroMetaTextTight: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: 0.1,
        textShadowColor: 'rgba(0,0,0,0.45)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    heroMetaFlag: {
        fontSize: 16,
        lineHeight: 20,
    },
    heroUsername: {
        marginTop: 4,
        color: 'rgba(255,255,255,0.86)',
        fontSize: 15,
        fontWeight: '600',
    },
    mutualRow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    mutualStack: { flexDirection: 'row', alignItems: 'center' },
    mutualAvatar: {
        borderWidth: 1.5,
        borderColor: '#FFF',
        borderRadius: 12,
        overflow: 'hidden',
    },
    mutualLabel: {
        flex: 1,
        color: 'rgba(255,255,255,0.92)',
        fontSize: 13,
        fontWeight: '600',
    },
    mutualLabelDark: { color: MUTED },
    mutualAvatarDark: { borderColor: '#FFF' },
    followRow: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    followExtra: {
        minWidth: 26,
        height: 26,
        paddingHorizontal: 7,
        borderRadius: 13,
        backgroundColor: '#0F172A',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: '#FFF',
    },
    followExtraText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    statsCard: {
        marginTop: -28,
        marginHorizontal: 14,
        backgroundColor: c.surface,
        borderRadius: 22,
        paddingVertical: 10,
        paddingHorizontal: 6,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        ...theme.shadows.card,
        zIndex: 2,
    },
    statsCardBelow: {
        marginTop: 16,
    },
    statCol: { flex: 1, alignItems: 'center', paddingHorizontal: 3, minWidth: 0 },
    statRule: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: c.border },
    statNumberWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
    statNumber: { fontSize: 25, fontWeight: '800', color: INK, letterSpacing: -0.5 },
    statBadge: {
        position: 'absolute',
        top: -4,
        right: -14,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: c.surface,
    },
    statBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    statLabel: {
        marginTop: 1,
        fontSize: 12.5,
        lineHeight: 14,
        fontWeight: '700',
        color: MUTED,
        textAlign: 'center',
        paddingHorizontal: 1,
    },
    ratingHead: { alignItems: 'center', gap: 2 },
    stars: { flexDirection: 'row', gap: 1 },
    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 20,
        marginTop: 18,
    },
    infoChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: c.surfaceSubtle,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        maxWidth: '100%',
    },
    infoChipText: { color: INK, fontSize: 13, fontWeight: '700', maxWidth: 220 },
    actionsCol: { paddingHorizontal: 20, marginTop: 18, gap: 10 },
    actionsRow: { flexDirection: 'row', gap: 10 },
    primaryBtn: {
        flex: 1,
        minWidth: 0,
        minHeight: 48,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 10,
    },
    primaryBtnText: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
    secondaryBtn: {
        flex: 1,
        minWidth: 0,
        minHeight: 48,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 10,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
    },
    secondaryBtnText: { fontSize: 13, fontWeight: '800', color: INK, flexShrink: 1 },
    section: { marginTop: 28, paddingHorizontal: 20 },
    sectionHead: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: INK,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    sectionAction: { fontSize: 13, fontWeight: '700', color: MUTED },
    interestRow: { gap: 14, paddingRight: 8 },
    interestTile: { width: 82, alignItems: 'center', gap: 8 },
    interestIcon: {
        width: 72,
        height: 72,
        borderRadius: 22,
        backgroundColor: c.surfaceSubtle,
        borderWidth: 1.5,
        borderColor: c.border,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
    },
    interestMoreIcon: {
        backgroundColor: '#F1F5F9',
        borderColor: '#E2E8F0',
        borderStyle: 'dashed' as const,
    },
    interestLabel: { fontSize: 12, fontWeight: '800', color: INK, textAlign: 'center' },
    morePlus: { fontSize: 17, fontWeight: '800', color: MUTED },
    emptyPlans: {
        backgroundColor: c.surfaceSubtle,
        borderRadius: 18,
        paddingVertical: 28,
        alignItems: 'center',
    },
    emptyPlansText: { color: MUTED, fontWeight: '700', fontSize: 14 },
    attendedRow: { gap: 12, paddingRight: 8 },
    attendedCard: { width: 168 },
    attendedImage: { width: 168, height: 118, borderRadius: 16, backgroundColor: c.border },
    attendedTitle: { marginTop: 8, fontSize: 14, fontWeight: '800', color: INK },
    attendedMeta: { marginTop: 2, fontSize: 12, fontWeight: '600', color: MUTED },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    gridCard: {
        width: '48%',
        flexGrow: 1,
        backgroundColor: c.surface,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    gridImage: { width: '100%', height: 118, backgroundColor: c.border },
    gridBody: { paddingHorizontal: 10, paddingVertical: 10, gap: 3 },
    gridTitle: { fontSize: 14, fontWeight: '800', color: INK },
    gridMeta: { fontSize: 12, fontWeight: '600', color: MUTED },
    gridCap: { fontSize: 12, fontWeight: '800', color: INK, marginTop: 2 },
    catChip: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: c.surfaceSubtle,
    },
    catChipText: { color: INK, fontWeight: '700', fontSize: 13 },
    orgIdentity: {
        paddingHorizontal: 16,
        marginTop: -48,
        zIndex: 3,
    },
    orgAvatar: { alignSelf: 'flex-start' },
    orgNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', marginTop: 12 },
    orgName: { flexShrink: 1, fontSize: 22, fontWeight: '800', color: INK, textAlign: 'left', letterSpacing: -0.4 },
    orgUserRow: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    orgUsername: { color: MUTED, fontWeight: '700', fontSize: 14, flexShrink: 1 },
    verifiedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: c.primarySoft,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    verifiedPillText: { color: ORG_PURPLE_DARK, fontWeight: '800', fontSize: 11 },
    orgAbout: {
        marginTop: 12,
        textAlign: 'left',
        color: c.textMuted,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: '600',
        paddingHorizontal: 4,
    },
    orgLinks: {
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 4,
    },
    orgLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: c.primarySoft,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        maxWidth: '100%',
    },
    orgLinkText: { color: ORG_PURPLE_DARK, fontWeight: '800', fontSize: 12, flexShrink: 1 },
    insightsBtn: {
        marginHorizontal: 20,
        marginTop: 16,
        minHeight: 48,
        borderRadius: 16,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    insightsIcon: {
        width: 30,
        height: 30,
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    insightsBtnText: { flex: 1, color: INK, fontSize: 15, fontWeight: '800' },
    editProfileBtn: {
        marginHorizontal: 20,
        marginTop: 16,
        minHeight: 48,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        position: 'relative',
    },
    editProfileBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
    editProfileHintDot: {
        position: 'absolute',
        top: 6,
        right: 10,
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#EF4444',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    galleryPlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15,23,42,0.28)',
    },
    });
}
