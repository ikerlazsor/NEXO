import { Text, TouchableOpacity, View } from "react-native";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { useT } from "../../lib/i18n";
import { createPlanDetailStyles } from "./planDetailStyles";
import { useThemedStyles } from "../../lib/appTheme";
import type { Participant } from "./types";

export function PersonBubble({
  person,
  isFriend,
  isAcquaintance: _isAcquaintance,
  subtitle,
  onPress,
  size = 72,
}: {
  person: Participant;
  isFriend: boolean;
  isAcquaintance?: boolean;
  subtitle?: string;
  onPress: () => void;
  size?: number;
}) {
  const { t } = useT();
  const styles = useThemedStyles(createPlanDetailStyles);
  const radius = size / 2;
  return (
    <TouchableOpacity
      style={styles.personBubble}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View
        style={[
          styles.personAvatarRing,
          { width: size, height: size, borderRadius: radius },
          isFriend && styles.personAvatarRingFriend,
        ]}
      >
        <ProfileAvatar
          uri={person.avatar_url}
          name={person.nombre}
          size={size}
          recyclingKey={person.id}
        />
      </View>
      <Text style={styles.personName} numberOfLines={1}>
        {person.nombre || t("planDetail.anonymous")}
      </Text>
      {subtitle ? (
        <Text style={styles.personSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}
