import { Ionicons } from "@expo/vector-icons";
import {
  Modal,
  Pressable,
  ScrollView,
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
import { styles } from "./profileStyles";

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
            contentContainerStyle={styles.modalTags}
            showsVerticalScrollIndicator={false}
          >
            {AFICIONES_OPTIONS.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.modalTag,
                    isSelected && styles.modalTagDisabled,
                  ]}
                  onPress={() => onAdd(option)}
                  disabled={isSelected}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.modalTagText,
                      isSelected && styles.modalTagTextDisabled,
                    ]}
                  >
                    {getPersonalityLabel(option, genero, t)}
                  </Text>
                  {isSelected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color="#94A3B8"
                    />
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
