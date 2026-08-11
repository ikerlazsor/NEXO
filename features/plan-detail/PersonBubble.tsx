import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View } from "react-native";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { useT } from "../../lib/i18n";
import { styles } from "./planDetailStyles";
import type { Participant } from "./types";

const FRIEND = "#10B981";
const ACQUAINTANCE = "#7C3AED";

export function PersonBubble({
  person,
  isFriend,
  isAcquaintance,
  subtitle,
  onPress,
  size = 64,
}: {
  person: Participant;
  isFriend: boolean;
  isAcquaintance?: boolean;
  subtitle?: string;
  onPress: () => void;
  size?: number;
}) {
  const { t, lang } = useT();
  const showAcquaintance = !!isAcquaintance && !isFriend;
  return (
    <TouchableOpacity
      style={styles.personBubble}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View
        style={[
          styles.personAvatarRing,
          { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 },
          isFriend && styles.personAvatarRingFriend,
          showAcquaintance && styles.personAvatarRingAcquaintance,
        ]}
      >
        <ProfileAvatar
          uri={person.avatar_url}
          name={person.nombre}
          size={size}
          recyclingKey={person.id}
        />
        {person.isCreator && (
          <View style={styles.creatorStar}>
            <Ionicons name="star" size={10} color="#FFF" />
          </View>
        )}
      </View>
      <Text
        style={[
          styles.personName,
          isFriend && styles.personNameFriend,
          showAcquaintance && styles.personNameAcquaintance,
        ]}
        numberOfLines={1}
      >
        {person.nombre || t("planDetail.anonymous")}
      </Text>
      {subtitle ? (
        <Text
          style={[
            styles.personSubtitle,
            isFriend && styles.personSubtitleFriend,
            showAcquaintance && styles.personSubtitleAcquaintance,
          ]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      ) : null}
      {isFriend ? (
        <View style={styles.friendPill}>
          <Ionicons name="heart" size={10} color={FRIEND} />
          <Text style={styles.friendPillText}>
            {t(
              person.genero === "femenino"
                ? "planDetail.friendF"
                : "planDetail.friend",
            )}
          </Text>
        </View>
      ) : showAcquaintance ? (
        <View style={styles.acquaintancePill}>
          <Ionicons name="people" size={10} color={ACQUAINTANCE} />
          <Text style={styles.acquaintancePillText}>
            {t(
              person.genero === "femenino"
                ? "planDetail.acquaintanceF"
                : "planDetail.acquaintance",
            )}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}
