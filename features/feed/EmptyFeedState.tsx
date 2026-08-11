import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View } from "react-native";
import { useT } from "../../lib/i18n";
import { styles } from "./feedStyles";

const PRIMARY = "#4DA6FF";
const PRIMARY_DARK = "#2563EB";

export const EmptySearch = ({
  onClear,
  onCreate,
  loadError,
  onRetry,
}: {
  onClear: () => void;
  onCreate: () => void;
  loadError?: boolean;
  onRetry?: () => void;
}) => {
  const { t } = useT();
  if (loadError) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="cloud-offline-outline" size={56} color={PRIMARY} />
        </View>
        <Text style={styles.emptyTitle}>{t("feed.loadError")}</Text>
        <TouchableOpacity style={styles.createBtnEmpty} onPress={onRetry}>
          <Text style={styles.createBtnEmptyText}>{t("feed.retry")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="compass-outline" size={56} color={PRIMARY} />
      </View>
      <Text style={styles.emptyTitle}>{t("feed.empty")}</Text>
      <Text style={styles.emptySubtitle}>{t("feed.emptySub")}</Text>
      <TouchableOpacity style={styles.createBtnEmpty} onPress={onCreate}>
        <Text style={styles.createBtnEmptyText}>{t("feed.emptyCreate")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onClear} style={{ marginTop: 14 }}>
        <Text style={{ color: PRIMARY_DARK, fontWeight: "800" }}>
          {t("feed.emptySeeAll")}
        </Text>
      </TouchableOpacity>
    </View>
  );
};
