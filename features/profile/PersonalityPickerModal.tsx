import { Ionicons } from "@expo/vector-icons";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useT } from "../../lib/i18n";
import {
  AFICIONES_OPTIONS,
  getPersonalityLabel,
  type Genero,
} from "../../lib/profileFields";
import { getInterestAccent, getInterestIcon } from "../../lib/profileInterests";
import { createProfileStyles } from "./profileStyles";
import { useThemedStyles } from "../../lib/appTheme";

const INK = "#0F172A";

export function PersonalityPickerModal({
  visible,
  selected,
  genero,
  onAdd,
  onClose,
}: {
  visible: boolean;
  selected: string[];
  genero: Genero | null;
  onAdd: (option: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const styles = useThemedStyles(createProfileStyles);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{t("profile.pickPersonality")}</Text>
          <Text style={styles.modalSub}>{t("profile.tagLimit")}</Text>
          <ScrollView
            contentContainerStyle={pickerStyles.grid}
            showsVerticalScrollIndicator={false}
          >
            {AFICIONES_OPTIONS.map((option) => {
              const isSelected = selected.includes(option);
              const accent = getInterestAccent(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    pickerStyles.tile,
                    {
                      backgroundColor: isSelected ? accent.selectedBg : accent.bg,
                      borderColor: isSelected ? accent.selectedBorder : accent.border,
                    },
                  ]}
                  onPress={() => onAdd(option)}
                  disabled={isSelected}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      pickerStyles.icon,
                      {
                        backgroundColor: isSelected ? accent.selectedBg : "#FFF",
                        borderColor: isSelected ? accent.selectedBorder : accent.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={getInterestIcon(option)}
                      size={26}
                      color={accent.icon}
                    />
                  </View>
                  <Text
                    style={[
                      pickerStyles.label,
                      isSelected && { color: accent.icon },
                    ]}
                    numberOfLines={2}
                  >
                    {getPersonalityLabel(option, genero, t)}
                  </Text>
                  {isSelected ? (
                    <View style={[pickerStyles.check, { backgroundColor: accent.icon }]}>
                      <Ionicons name="checkmark" size={12} color="#FFF" />
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>{t("profile.cancel")}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingBottom: 8,
  },
  tile: {
    width: "47%",
    flexGrow: 1,
    alignItems: "center",
    gap: 10,
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    position: "relative",
  },
  icon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F2A4A",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: "800",
    color: INK,
    textAlign: "center",
  },
  check: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
