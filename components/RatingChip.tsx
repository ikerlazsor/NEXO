import { PressScale } from './PressScale';
import { useThemedStyles } from '../lib/appTheme';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { type ThemeColors } from '../theme';

type Props = {
    label: string;
    selected?: boolean;
    onPress: () => void;
    selectedStyle?: StyleProp<ViewStyle>;
    textSelectedColor?: string;
};

/** Chip con micro-escala al pulsar (valoraciones). */
export function RatingChip({
    label,
    selected,
    onPress,
    selectedStyle,
    textSelectedColor = '#FFF',
}: Props) {
    const styles = useThemedStyles(createChipStyles);
    return (
        <PressScale
            onPress={onPress}
            pressedScale={0.96}
            style={[styles.chip, selected && selectedStyle]}
        >
            <Text style={[styles.text, selected && { color: textSelectedColor }]}>{label}</Text>
        </PressScale>
    );
}

function createChipStyles(c: ThemeColors) {
    return StyleSheet.create({
        chip: {
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surfaceSubtle,
        },
        text: {
            fontSize: 13,
            fontWeight: '700',
            color: c.textMuted,
        },
    });
}
