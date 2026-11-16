import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { useT } from '../../lib/i18n';
import { createChatStyles } from './chatStyles';

export function ChatHeader({ title, subtitle, onBack, onInfo, onInfoPressIn, image, actions }: {
  title: string; subtitle?: string; onBack: () => void; onInfo: () => void;
  onInfoPressIn?: () => void; image: ReactNode; actions?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createChatStyles);
  const { colors } = useAppTheme();
  const { t } = useT();
  return <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
    <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('common.back')}>
      <Ionicons name="chevron-back" size={28} color={colors.brand} />
    </TouchableOpacity>
    {image}
    <TouchableOpacity style={styles.headerTitleContainer} activeOpacity={0.7} onPressIn={onInfoPressIn} onPress={onInfo}>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {!!subtitle && <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text>}
    </TouchableOpacity>
    {actions}
  </View>;
}
