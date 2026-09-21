import { useMemo } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { hapticMedium } from '../lib/haptics';
import { type ThemeColors } from '../theme';

type Props = {
    value: Date;
    onChange: (next: Date) => void;
    /** Días hacia adelante (default 30). */
    days?: number;
    locale?: string;
    minDate?: Date;
};

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function sameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate()
    );
}

/** Mini calendario de los próximos N días (rejilla de recuadros). */
export function PlanDayCalendar({
    value,
    onChange,
    days = 30,
    locale = 'es-ES',
    minDate,
}: Props) {
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const today = useMemo(() => startOfDay(new Date()), []);
    const min = startOfDay(minDate ?? today);

    const items = useMemo(() => {
        const out: Date[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            out.push(d);
        }
        return out;
    }, [days, today]);

    return (
        <View style={styles.grid}>
            {items.map((d) => {
                const disabled = d.getTime() < min.getTime();
                const selected = sameDay(d, value);
                const isToday = sameDay(d, today);
                const weekday = d
                    .toLocaleDateString(locale, { weekday: 'short' })
                    .replace(/\./g, '')
                    .slice(0, 3);
                return (
                    <Pressable
                        key={d.toISOString()}
                        disabled={disabled}
                        onPress={() => {
                            if (disabled) return;
                            hapticMedium();
                            const next = new Date(value);
                            next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                            onChange(next);
                        }}
                        style={[
                            styles.cell,
                            isToday && styles.cellToday,
                            selected && styles.cellSelected,
                            disabled && styles.cellDisabled,
                        ]}
                    >
                        <Text
                            style={[
                                styles.weekday,
                                isToday && styles.weekdayToday,
                                selected && styles.weekdaySelected,
                            ]}
                        >
                            {weekday}
                        </Text>
                        <Text
                            style={[
                                styles.dayNum,
                                isToday && styles.dayNumToday,
                                selected && styles.dayNumSelected,
                            ]}
                        >
                            {d.getDate()}
                        </Text>
                        {isToday ? (
                            <View style={[styles.todayDot, selected && { backgroundColor: colors.onPrimary }]} />
                        ) : (
                            <View style={styles.todayDotSpacer} />
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
        grid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'flex-start',
        },
        cell: {
            width: '18%',
            minWidth: 56,
            flexGrow: 1,
            maxWidth: '19.5%',
            paddingVertical: 10,
            borderRadius: 16,
            backgroundColor: c.surfaceSubtle,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
        },
        cellToday: {
            borderColor: c.brand,
            borderWidth: 2,
            backgroundColor: c.primarySoft,
            shadowColor: c.brand,
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 2,
        },
        cellSelected: {
            backgroundColor: c.primary,
            borderColor: c.primary,
            shadowOpacity: 0,
            elevation: 0,
        },
        cellDisabled: {
            opacity: 0.35,
        },
        weekday: {
            fontSize: 10,
            fontWeight: '700',
            color: c.textMuted,
            textTransform: 'capitalize',
        },
        weekdayToday: {
            color: c.primary,
        },
        weekdaySelected: {
            color: 'rgba(255,255,255,0.85)',
        },
        dayNum: {
            fontSize: 17,
            fontWeight: '900',
            color: c.text,
        },
        dayNumToday: {
            color: c.primary,
        },
        dayNumSelected: {
            color: '#FFF',
        },
        todayDot: {
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: c.brand,
            marginTop: 2,
        },
        todayDotSpacer: {
            width: 5,
            height: 5,
            marginTop: 2,
        },
    });
}
