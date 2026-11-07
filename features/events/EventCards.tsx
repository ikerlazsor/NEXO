import { memo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { useT } from "../../lib/i18n";
import { useAppTheme } from "../../lib/appTheme";
import { eventClassification, eventCoverSource } from "./covers";
import type { ExternalEvent, EventSection } from "./types";
import { PressScale } from "../../components/PressScale";
export function eventDateLabel(
  event: Pick<ExternalEvent, "start_date">,
  lang: string,
) {
  const date = new Date(`${event.start_date}T12:00:00Z`);
  return date.toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  });
}
// These are illustrative covers from the existing Nexo catalog, not photos of the event.
export function EventArtwork({
  event,
  compact = false,
}: {
  event: ExternalEvent;
  compact?: boolean;
}) {
  const { t } = useT();
  const { category, subcategory } = eventClassification(event);
  return (
    <Image
      source={eventCoverSource(event)}
      style={[s.art, compact ? s.artCompact : s.artLarge]}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={`${event.provider_id}:${event.source_id}:${category}:${subcategory}`}
      transition={120}
      accessibilityLabel={`${t("events.illustrativeCover")} · ${t(`cat.sub.${subcategory}`)}`}
    />
  );
}
export const EventCard = memo(function EventCard({
  event,
  variant,
  joined = false,
  busy = false,
  onOpen,
  onJoin,
  preview = false,
}: {
  event: ExternalEvent;
  variant: "compact" | "editorial";
  joined?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onJoin: () => void;
  preview?: boolean;
}) {
  const { t, lang } = useT();
  const { colors } = useAppTheme();
  const compact = variant === "compact";
  const date = eventDateLabel(event, lang);
  const classification = eventClassification(event);
  return (
    <View
      style={[
        s.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        compact && s.compact,
      ]}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${date}`}
        style={compact ? s.compactOpen : undefined}
      >
        <View>
          <EventArtwork event={event} compact={compact} />
        </View>
        <View style={[s.body, compact && s.compactBody]}>
          <Text style={[s.category, { color: colors.primary }]}>
            {t(`cat.main.${classification.category}`)} ·{" "}
            {t(`cat.sub.${classification.subcategory}`)} ·{" "}
            {compact ? "MADRID" : t("events.source")}
          </Text>
          <Text
            numberOfLines={compact ? 2 : 3}
            style={[s.title, { color: colors.text }, compact && s.compactTitle]}
          >
            {event.title}
          </Text>
          <View style={[s.meta, s.dateMeta]}>
            <Ionicons
              name="calendar-outline"
              size={15}
              color={colors.primary}
            />
            <Text style={[s.metaText, { color: colors.primary }]}>
              {date}
              {event.end_date !== event.start_date
                ? ` — ${eventDateLabel({ start_date: event.end_date }, lang)}`
                : ""}
            </Text>
          </View>
          <View style={s.meta}>
            <Ionicons
              name="location-outline"
              size={14}
              color={colors.textMuted}
            />
            <Text
              numberOfLines={1}
              style={[s.metaText, { color: colors.textMuted }]}
            >
              {event.venue || t("events.venueUnknown")}
            </Text>
          </View>
        </View>
      </Pressable>
      <View style={[s.actions, compact && s.compactActions]}>
        {!compact && (
          <Text style={[s.socialHint, { color: colors.textMuted }]}>
            {t("events.subtitle")}
          </Text>
        )}
        <PressScale
          onPress={onJoin}
          disabled={busy || preview}
          accessibilityRole="button"
          accessibilityLabel={joined ? t("events.joined") : t("events.join")}
          style={[
            s.join,
            { backgroundColor: joined ? colors.primarySoft : colors.primary },
            preview && s.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons
              name={joined ? "checkmark" : "add"}
              size={17}
              color={joined ? colors.primary : colors.onPrimary}
            />
          )}
          <Text
            style={[
              s.joinText,
              { color: joined ? colors.primary : colors.onPrimary },
            ]}
          >
            {joined ? t("events.joined") : t("events.join")}
          </Text>
        </PressScale>
      </View>
    </View>
  );
});
export function EventTabs({
  value,
  onChange,
}: {
  value: EventSection;
  onChange: (section: EventSection) => void;
}) {
  const { t } = useT();
  const { colors } = useAppTheme();
  return (
    <View
      style={[s.tabs, { backgroundColor: colors.surfaceSubtle }]}
      accessibilityRole="tablist"
    >
      {(["forYou", "plans", "agenda"] as const).map((section) => (
        <Pressable
          key={section}
          onPress={() => onChange(section)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === section }}
          style={[
            s.tab,
            value === section && {
              backgroundColor: colors.surface,
              shadowColor: colors.text,
              shadowOpacity: 0.08,
              shadowRadius: 5,
              elevation: 2,
            },
          ]}
        >
          <Text
            style={[
              s.tabText,
              { color: value === section ? colors.primary : colors.textMuted },
            ]}
          >
            {t(`events.${section}`)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export const eventStyles = safeStyles();
function safeStyles() {
  return StyleSheet.create({
    screen: { flex: 1 },
    content: { padding: 20, paddingBottom: 48 },
    back: {
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    heading: { fontSize: 26, fontWeight: "800", marginVertical: 16 },
    paragraph: { fontSize: 16, lineHeight: 24, marginVertical: 10 },
    button: {
      borderRadius: 18,
      padding: 16,
      alignItems: "center",
      marginVertical: 8,
    },
    buttonText: { fontSize: 16, fontWeight: "700" },
    notice: { padding: 16, borderRadius: 18, marginVertical: 12 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
    },
    link: { fontSize: 15, fontWeight: "600", paddingVertical: 12 },
  });
}
const s = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 18,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
  },
  compact: { borderRadius: 21 },
  compactOpen: { flexDirection: "row", padding: 12, gap: 14 },
  art: { overflow: "hidden", justifyContent: "center", alignItems: "center" },
  artCompact: { width: 98, height: 112, borderRadius: 15 },
  artLarge: { height: 212, width: "100%" },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  compactBody: { padding: 0, paddingTop: 4, flex: 1 },
  category: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  title: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  compactTitle: {
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  meta: { flexDirection: "row", gap: 5, alignItems: "center" },
  metaText: { fontSize: 12, flex: 1 },
  dateMeta: { marginBottom: 8 },
  actions: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 18,
    paddingTop: 6,
  },
  compactActions: { justifyContent: "flex-end", padding: 12, paddingTop: 0 },
  socialHint: { fontSize: 12, lineHeight: 17, flex: 1 },
  join: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    minHeight: 42,
  },
  joinText: { fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  tabs: {
    flexDirection: "row",
    padding: 5,
    gap: 4,
    borderRadius: 18,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 14,
  },
  tabText: { fontSize: 14, fontWeight: "700" },
  intro: { marginHorizontal: 22, marginTop: 12, marginBottom: 24 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: 10,
  },
  headline: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    fontWeight: "800",
    maxWidth: 310,
  },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 10 },
});
