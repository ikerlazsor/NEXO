import { memo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import { EventArtwork, eventWhenLabel } from "./EventCards";
import type { ExternalEvent } from "./types";

/** Evento de la agenda guardado: miniatura, cuándo/dónde y quitar de guardados. */
export const SavedEventRow = memo(function SavedEventRow({
  event,
  onOpen,
  onRemove,
}: {
  event: ExternalEvent;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { colors } = useAppTheme();
  const { t, lang } = useT();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={event.title}
      style={({ pressed }) => [s.row, { backgroundColor: colors.surface, opacity: pressed ? 0.92 : 1 }]}
    >
      <EventArtwork event={event} compact style={s.thumb} />
      <View style={s.text}>
        <Text style={[s.when, { color: colors.primary }]} numberOfLines={1}>{eventWhenLabel(event, lang)}</Text>
        <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>{event.title}</Text>
        {!!event.venue && <Text style={[s.venue, { color: colors.textMuted }]} numberOfLines={1}>{event.venue}</Text>}
      </View>
      <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("card.unsave")} style={s.heart}>
        <Ionicons name="heart" size={22} color="#E11D48" />
      </Pressable>
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 18,
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  thumb: { width: 76, height: 76, borderRadius: 14 },
  text: { flex: 1, minWidth: 0, gap: 3 },
  when: { fontSize: 12, fontWeight: "800" },
  title: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
  venue: { fontSize: 12 },
  heart: { padding: 6 },
});
