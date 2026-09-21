import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageSource } from 'expo-image';
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
  icon?: IconName;
  image?: ImageSource;
  imageSize?: number;
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
  image,
  imageSize = 168,
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
      {image ? (
        <Image
          source={image}
          style={{ width: imageSize, height: imageSize }}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={typeof image === 'number' ? `local-${image}` : undefined}
          transition={0}
        />
      ) : icon ? (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={48} color={colors.primary} />
        </View>
      ) : null}
      <Text
        allowFontScaling
        maxFontSizeMultiplier={theme.accessibility.maximumTextScale}
        style={[styles.title, image ? styles.titleAfterImage : null]}
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
    titleAfterImage: {
      marginTop: theme.spacing.sm,
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
