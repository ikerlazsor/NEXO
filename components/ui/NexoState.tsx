import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme, type ThemeColors } from '../../theme';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { NexoButton } from './NexoButton';

type IconName = ComponentProps<typeof Ionicons>['name'];

type EmptyProps = {
  icon: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function NexoEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
  style,
}: EmptyProps) {
  const styles = useThemedStyles(createStateStyles);
  const { colors } = useAppTheme();
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={48} color={colors.primary} />
      </View>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={theme.accessibility.maximumTextScale}
        style={styles.title}
      >
        {title}
      </Text>
      {description ? (
        <Text
          allowFontScaling
          maxFontSizeMultiplier={theme.accessibility.maximumTextScale}
          style={styles.description}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <NexoButton label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
      {secondaryLabel && onSecondaryAction ? (
        <NexoButton
          label={secondaryLabel}
          onPress={onSecondaryAction}
          variant="ghost"
          style={styles.secondary}
        />
      ) : null}
    </View>
  );
}

export function NexoLoadingState({
  label = 'Cargando',
  style,
}: {
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(createStateStyles);
  const { colors } = useAppTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.loading, style]}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text
        allowFontScaling
        maxFontSizeMultiplier={theme.accessibility.maximumTextScale}
        style={styles.loadingLabel}
      >
        {label}
      </Text>
    </View>
  );
}

function createStateStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.xxxl,
    },
    iconWrap: {
      width: 96,
      height: 96,
      borderRadius: theme.radii.pill,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      ...theme.shadows.card,
    },
    title: {
      ...theme.typography.title,
      color: c.text,
      textAlign: 'center',
      marginTop: theme.spacing.lg,
    },
    description: {
      ...theme.typography.bodySmall,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: theme.spacing.xs,
      maxWidth: 440,
    },
    action: { marginTop: theme.spacing.lg },
    secondary: { marginTop: theme.spacing.xs },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      backgroundColor: c.background,
      padding: theme.spacing.xl,
    },
    loadingLabel: {
      ...theme.typography.bodySmall,
      color: c.textMuted,
      textAlign: 'center',
    },
  });
}
