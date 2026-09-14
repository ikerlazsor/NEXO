import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PlanImage } from './PlanImage';
import { ProfileAvatar } from './ProfileAvatar';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { type MyPlanItem } from '../lib/myPlansQuery';
import { stripPlanTitleSuffix } from '../lib/planDisplay';
import { formatCountdown, resolveRatingUiPhase } from '../lib/planLifecycle';
import { type PendingRatingPlan } from '../lib/ratings';
import { resolvePlanImageSource } from '../lib/sports';
import { type ThemeColors } from '../theme';

type Props = {
    item: MyPlanItem;
    showUpcomingHeader: boolean;
    showPastHeader: boolean;
    pastHeaderExtraMargin: boolean;
    upcomingLabel: string;
    pastLabel: string;
    rating?: PendingRatingPlan;
    locale: string;
    joinedLabel: string;
    requestsTitle: string;
    viewProfileLabel: string;
    fullHint: string;
    closePlanLabel: string;
    rateProgressLabel: string;
    rateUnlockLabel?: string;
    nowTick: number;
    onOpenPlan: (item: MyPlanItem) => void;
    onOpenChat: (planId: string) => void;
    onOpenRate: (planId: string) => void;
    onOpenProfile: (userId: string) => void;
    onAccept: (planId: string, userId: string) => void;
    onReject: (planId: string, userId: string) => void;
};

function formatDate(iso: string | null, locale: string) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export const MyPlanListRow = memo(function MyPlanListRow({
    item,
    showUpcomingHeader,
    showPastHeader,
    pastHeaderExtraMargin,
    upcomingLabel,
    pastLabel,
    rating,
    locale,
    joinedLabel,
    requestsTitle,
    viewProfileLabel,
    fullHint,
    closePlanLabel,
    rateProgressLabel,
    rateUnlockLabel,
    nowTick,
    onOpenPlan,
    onOpenChat,
    onOpenRate,
    onOpenProfile,
    onAccept,
    onReject,
}: Props) {
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createMyPlanRowStyles);
    const isFull = item.joinedCount >= item.maximo_participantes;
    const isCreator = item.role === 'creator';

    return (
        <View>
            {showUpcomingHeader ? (
                <Text style={styles.sectionLabel}>{upcomingLabel}</Text>
            ) : null}
            {showPastHeader ? (
                <Text style={[styles.sectionLabel, pastHeaderExtraMargin && { marginTop: 8 }]}>
                    {pastLabel}
                </Text>
            ) : null}
            <TouchableOpacity
                style={[styles.card, item.isPast && styles.cardPast]}
                activeOpacity={0.88}
                onPress={() => onOpenPlan(item)}
            >
                <View style={styles.cardHeader}>
                    <PlanImage
                        source={resolvePlanImageSource(item.imagen_url)}
                        style={styles.thumb}
                        recyclingKey={String(item.id)}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{stripPlanTitleSuffix(item.titulo)}</Text>
                        {item.fecha_evento ? (
                            <Text style={styles.dateText}>{formatDate(item.fecha_evento, locale)}</Text>
                        ) : null}
                        <View style={styles.countRow}>
                            <Ionicons name="people" size={14} color={isFull ? '#B8860B' : colors.primary} />
                            <Text style={[styles.countText, isFull && { color: '#B8860B' }]}>
                                {item.joinedCount}/{item.maximo_participantes}
                            </Text>
                            {!item.isPast && !isCreator ? (
                                <View style={styles.memberTag}>
                                    <Text style={styles.memberTagText}>{joinedLabel}</Text>
                                </View>
                            ) : null}
                        </View>
                        {rating ? (
                            resolveRatingUiPhase(rating, nowTick) === 'waiting' ? (
                                <View style={[styles.rateChip, styles.rateChipWait]}>
                                    <Ionicons name="hourglass-outline" size={13} color={colors.warning} />
                                    <Text style={styles.rateChipWaitText}>
                                        {rateUnlockLabel}
                                    </Text>
                                </View>
                            ) : (
                            <TouchableOpacity
                                style={styles.rateChip}
                                onPress={(e) => {
                                    e.stopPropagation?.();
                                    onOpenRate(item.id);
                                }}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="star" size={13} color={colors.primary} />
                                <Text style={styles.rateChipText}>
                                    {rating.pendingCount < rating.totalPeers
                                        ? rateProgressLabel
                                        : closePlanLabel}
                                </Text>
                            </TouchableOpacity>
                            )
                        ) : null}
                    </View>
                    {!item.isPast ? (
                        <TouchableOpacity
                            style={styles.chatBtn}
                            onPress={(e) => {
                                e.stopPropagation?.();
                                onOpenChat(item.id);
                            }}
                        >
                            <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
                        </TouchableOpacity>
                    ) : (
                        <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                    )}
                </View>

                {isCreator && !item.isPast && item.pending.length > 0 ? (
                    <View style={styles.requestsBlock}>
                        <Text style={styles.requestsTitle}>{requestsTitle}</Text>
                        {item.pending.map((p) => (
                            <View key={p.id} style={styles.requestRow}>
                                <TouchableOpacity
                                    style={styles.requestUser}
                                    onPress={() => onOpenProfile(p.id)}
                                >
                                    <View style={{ marginRight: 10 }}>
                                        <ProfileAvatar
                                            uri={p.avatar_url}
                                            name={p.nombre || 'U'}
                                            size={36}
                                            recyclingKey={p.id}
                                            priority="normal"
                                        />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.reqName} numberOfLines={1}>
                                            {p.nombre || 'U'}
                                        </Text>
                                        <Text style={styles.reqHint}>{viewProfileLabel}</Text>
                                    </View>
                                </TouchableOpacity>
                                <View style={styles.reqActions}>
                                    <TouchableOpacity
                                        style={[
                                            styles.reqBtn,
                                            { backgroundColor: isFull ? '#E2E8F0' : colors.success },
                                        ]}
                                        onPress={() => !isFull && onAccept(item.id, p.id)}
                                        disabled={isFull}
                                    >
                                        <Ionicons name="checkmark" size={20} color="#FFF" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.reqBtn, styles.reqReject]}
                                        onPress={() => onReject(item.id, p.id)}
                                    >
                                        <Ionicons name="close" size={20} color={colors.danger} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))}
                        {isFull ? <Text style={styles.fullHint}>{fullHint}</Text> : null}
                    </View>
                ) : null}
            </TouchableOpacity>
        </View>
    );
}, (prev, next) => {
    return (
        prev.item.id === next.item.id
        && prev.item.pending.length === next.item.pending.length
        && prev.item.joinedCount === next.item.joinedCount
        && prev.item.isPast === next.item.isPast
        && prev.showUpcomingHeader === next.showUpcomingHeader
        && prev.showPastHeader === next.showPastHeader
        && prev.pastHeaderExtraMargin === next.pastHeaderExtraMargin
        && prev.rating === next.rating
        && prev.locale === next.locale
        && prev.joinedLabel === next.joinedLabel
        && prev.requestsTitle === next.requestsTitle
        && prev.upcomingLabel === next.upcomingLabel
        && prev.pastLabel === next.pastLabel
        && prev.rateProgressLabel === next.rateProgressLabel
        && prev.closePlanLabel === next.closePlanLabel
        && prev.onOpenPlan === next.onOpenPlan
        && prev.onOpenChat === next.onOpenChat
        && prev.onOpenRate === next.onOpenRate
        && prev.onOpenProfile === next.onOpenProfile
        && prev.onAccept === next.onAccept
        && prev.onReject === next.onReject
    );
});

function createMyPlanRowStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY_DARK = c.primary;
    const GOLD = '#B45309';
    return StyleSheet.create({
        sectionLabel: {
            fontSize: 12,
            fontWeight: '800',
            color: c.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            marginBottom: 10,
            marginLeft: 2,
        },
        card: {
            backgroundColor: c.surface,
            borderRadius: 22,
            padding: 16,
            marginBottom: 16,
            elevation: 5,
            shadowColor: '#000',
            shadowOpacity: 0.14,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 5 },
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
        },
        cardPast: { opacity: 0.82 },
        cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
        thumb: { width: 72, height: 72, borderRadius: 18, backgroundColor: c.border },
        cardTitle: { fontSize: 17, fontWeight: '800', color: INK, marginBottom: 2 },
        dateText: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
        memberTag: {
            marginLeft: 6,
            backgroundColor: c.primarySoft,
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 8,
        },
        memberTagText: { fontSize: 11, fontWeight: '800', color: PRIMARY_DARK },
        rateChip: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            alignSelf: 'flex-start',
            marginTop: 8,
            backgroundColor: c.primarySoft,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 10,
        },
        rateChipText: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK },
    rateChipWait: { backgroundColor: c.warningSoft },
    rateChipWaitText: { fontSize: 12, fontWeight: '700', color: '#92400E', flexShrink: 1 },
        countRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
        countText: { fontSize: 13, fontWeight: '700', color: PRIMARY_DARK },
        chatBtn: {
            width: 40,
            height: 40,
            borderRadius: 14,
            backgroundColor: c.surfaceSubtle,
            justifyContent: 'center',
            alignItems: 'center',
        },
        requestsBlock: {
            marginTop: 14,
            paddingTop: 14,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
        },
        requestsTitle: {
            fontSize: 12,
            fontWeight: '800',
            color: PRIMARY_DARK,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            marginBottom: 10,
        },
        requestRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
        requestUser: { flexDirection: 'row', alignItems: 'center', flex: 1 },
        reqName: { fontSize: 15, fontWeight: '700', color: INK },
        reqHint: { fontSize: 12, color: PRIMARY_DARK, fontWeight: '600', marginTop: 1 },
        reqActions: { flexDirection: 'row', gap: 8 },
        reqBtn: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
        reqReject: { backgroundColor: c.dangerSoft },
        fullHint: { fontSize: 12, color: GOLD, marginTop: 4 },
    });
}
