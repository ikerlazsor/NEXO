import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme, type ThemeColors } from '../../theme';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

type Props = {
  label: string;
  onPress?: PressableProps['onPress'];
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  leftIcon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function NexoButton({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  accessibilityLabel,
  leftIcon,
  style,
}: Props) {
  const styles = useThemedStyles(createButtonStyles);
  const { colors } = useAppTheme();
  const unavailable = disabled || busy;
  const spinnerColor =
    variant === 'primary' || variant === 'danger' ? colors.onPrimary : colors.primary;
  const labelStyle =
    variant === 'primary'
      ? styles.primaryLabel
      : variant === 'secondary'
        ? styles.secondaryLabel
        : variant === 'danger'
          ? styles.dangerLabel
          : styles.ghostLabel;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !unavailable ? styles.pressed : null,
        unavailable ? styles.disabled : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={spinnerColor} /> : leftIcon}
      <Text
        allowFontScaling
        maxFontSizeMultiplier={theme.accessibility.maximumTextScale}
        style={[styles.label, labelStyle]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function createButtonStyles(c: ThemeColors) {
  return StyleSheet.create({
    base: {
      minHeight: theme.accessibility.minimumTouchTarget,
      minWidth: theme.accessibility.minimumTouchTarget,
      borderRadius: theme.radii.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: theme.spacing.xs,
    },
    primary: { backgroundColor: c.primary },
    secondary: {
      backgroundColor: c.primarySoft,
      borderWidth: 1,
      borderColor: c.primaryBorder,
    },
    danger: { backgroundColor: c.danger },
    ghost: { backgroundColor: 'transparent' },
    pressed: { opacity: 0.78 },
    disabled: { opacity: 0.5 },
    label: {
      ...theme.typography.bodySmall,
      textAlign: 'center',
      flexShrink: 1,
    },
    primaryLabel: { color: c.onPrimary },
    secondaryLabel: { color: c.primary },
    dangerLabel: { color: c.onPrimary },
    ghostLabel: { color: c.primary },
  });
}
