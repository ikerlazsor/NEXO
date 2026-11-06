import { memo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { useT } from "../../lib/i18n";
import { useAppTheme } from "../../lib/appTheme";
import { MAIN_CATEGORY_ICONS } from "../../lib/categories";
import type { ExternalEvent, EventSection } from "./types";
import { PressScale } from "../../components/PressScale";
const PALETTES = {
  SHOWTIME: ["#252C75", "#666BCA"],
  DESCUBRIR: ["#1D5581", "#4F9BB4"],
  AIRE_LIBRE: ["#1F6655", "#75A77B"],
  DEPORTES: ["#254FA0", "#6399DA"],
  FOODIES: ["#9E4C3D", "#DA9E79"],
  VIBES: ["#68448D", "#B189BA"],
} as const;
export function eventDateLabel(event: ExternalEvent, lang: string) {
  const date = new Date(`${event.start_date}T12:00:00Z`);
  return date.toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  });
}
// Original category artwork: no unverified photographs or third-party imagery.
export function EventArtwork({
  event,
  compact = false,
}: {
  event: ExternalEvent;
  compact?: boolean;
}) {
  const palette = PALETTES[event.category] ?? PALETTES.DESCUBRIR;
  return (
    <LinearGradient
      colors={[palette[0], palette[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.art, compact ? s.artCompact : s.artLarge]}
    >
      <View style={[s.orbit, compact && s.smallOrbit]} />
      <View style={s.orbitInner} />
      <View style={s.artIcon}>
        <Ionicons
          name={
            MAIN_CATEGORY_ICONS[
              event.category
            ] as keyof typeof Ionicons.glyphMap
          }
          size={compact ? 34 : 68}
          color="#FFFFFF"
        />
      </View>
      {!compact && <Text style={s.artWord}>MADRID</Text>}
    </LinearGradient>
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
          {!compact && (
            <View style={s.dateBadge}>
              <Text style={s.dateBadgeText}>{date}</Text>
            </View>
          )}
        </View>
        <View style={[s.body, compact && s.compactBody]}>
          <Text style={[s.category, { color: colors.primary }]}>
            {t(`cat.main.${event.category}`)} ·{" "}
            {compact ? "MADRID" : t("events.source")}
          </Text>
          <Text
            numberOfLines={compact ? 2 : 3}
            style={[s.title, { color: colors.text }, compact && s.compactTitle]}
          >
            {event.title}
          </Text>
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
          {compact && (
            <Text style={[s.date, { color: colors.textMuted }]}>{date}</Text>
          )}
          {!compact && event.end_date !== event.start_date && (
            <Text style={[s.date, { color: colors.textMuted }]}>
              {t("events.until")} {event.end_date}
            </Text>
          )}
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
          {section === "forYou" && (
            <Ionicons
              name="sparkles"
              size={14}
              color={value === section ? colors.primary : colors.textMuted}
            />
          )}
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
export function AgendaIntro() {
  const { t } = useT();
  const { colors } = useAppTheme();
  return (
    <View style={s.intro}>
      <Text style={[s.eyebrow, { color: colors.primary }]}>
        {t("events.eyebrow")}
      </Text>
      <Text style={[s.headline, { color: colors.text }]}>
        {t("events.headline")}
      </Text>
      <Text style={[s.subtitle, { color: colors.textMuted }]}>
        {t("events.subtitle")}
      </Text>
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
  orbit: {
    position: "absolute",
    width: 270,
    height: 270,
    borderRadius: 150,
    borderWidth: 38,
    borderColor: "rgba(255,255,255,0.10)",
    right: -45,
    top: -90,
    transform: [{ rotate: "-30deg" }],
  },
  smallOrbit: {
    width: 150,
    height: 150,
    borderWidth: 22,
    right: -65,
    top: -30,
  },
  orbitInner: {
    position: "absolute",
    left: -30,
    bottom: -65,
    width: 180,
    height: 180,
    borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  artIcon: { transform: [{ rotate: "-9deg" }] },
  artWord: {
    position: "absolute",
    bottom: 20,
    right: 20,
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 4,
  },
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
  date: { fontSize: 12, marginTop: 5 },
  dateBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 14,
  },
  dateBadgeText: { fontSize: 15, color: "#0F2A4A", fontWeight: "800" },
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
