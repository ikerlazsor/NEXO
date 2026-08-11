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
import { theme } from '../../theme';

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
  const unavailable = disabled || busy;
  const spinnerColor =
    variant === 'primary' || variant === 'danger'
      ? theme.colors.surface
      : theme.colors.primary;
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

const styles = StyleSheet.create({
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
  primary: { backgroundColor: theme.colors.primary },
  secondary: {
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
  },
  danger: { backgroundColor: theme.colors.danger },
  ghost: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  label: {
    ...theme.typography.bodySmall,
    textAlign: 'center',
    flexShrink: 1,
  },
  primaryLabel: { color: theme.colors.surface },
  secondaryLabel: { color: theme.colors.primary },
  dangerLabel: { color: theme.colors.surface },
  ghostLabel: { color: theme.colors.primary },
});
