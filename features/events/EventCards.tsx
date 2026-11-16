import { memo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ImageStyle } from "expo-image";
import type { StyleProp } from "react-native";
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
import type { ExternalEvent, EventSection, EventSocialSummary } from "./types";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { PressScale } from "../../components/PressScale";
import { getCategoryColor } from "../../lib/categories";
import {
  planCardActionStyles,
  JOINED_PLAN_COLORS,
} from "../../components/planCardActions";
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
/** «Gratis» solo cuando la fuente lo dice; sin precio no se asume nada. */
export function isFreeEvent(priceText: string | null | undefined) {
  return /\b(gratis|gratuit[oa]s?|entrada libre|free)\b/i.test(String(priceText || "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
}
/** «Jue 20 nov · 19:00»: día de la semana primero, que es como se decide un plan. */
export function eventWhenLabel(
  event: Pick<ExternalEvent, "start_date" | "end_date" | "starts_at">,
  lang: string,
) {
  const base = event.starts_at ? new Date(event.starts_at) : new Date(`${event.start_date}T12:00:00Z`);
  const day = base.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" }).replace(/\./g, "");
  const cap = day.charAt(0).toUpperCase() + day.slice(1);
  const time = event.starts_at
    ? ` · ${base.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}`
    : "";
  const until = event.end_date && event.end_date !== event.start_date ? ` — ${eventDateLabel({ start_date: event.end_date }, lang)}` : "";
  return `${cap}${time}${until}`;
}
// These are illustrative covers from the existing Nexo catalog, not photos of the event.
export function EventArtwork({
  event,
  compact = false,
  style,
}: {
  event: ExternalEvent;
  compact?: boolean;
  style?: StyleProp<ImageStyle>;
}) {
  const { t } = useT();
  const { category, subcategory } = eventClassification(event);
  return (
    <Image
      source={eventCoverSource(event)}
      style={[s.art, compact ? s.artCompact : s.artLarge, style]}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={`${event.provider_id}:${event.source_id}:${category}:${subcategory}`}
      transition={0}
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
  horizontalInset = 16,
  social,
}: {
  event: ExternalEvent;
  variant: "compact" | "editorial";
  joined?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onJoin: () => void;
  preview?: boolean;
  horizontalInset?: number;
  social?: EventSocialSummary;
}) {
  const { t, lang } = useT();
  const { colors, scheme } = useAppTheme();
  const actionStyles = planCardActionStyles(scheme === "dark");
  const compact = variant === "compact";
  const date = eventDateLabel(event, lang);
  const classification = eventClassification(event);
  const accent = getCategoryColor(classification.category);
  const dark = scheme === "dark";
  const free = isFreeEvent(event.price_text);
  const when = eventWhenLabel(event, lang);
  return (
    <View
      style={[
        s.card,
        { marginHorizontal: horizontalInset },
        {
          backgroundColor: colors.surface,
          borderColor: dark ? colors.borderStrong : "rgba(15,23,42,0.07)",
          shadowColor: dark ? "#000" : "#0F172A",
        },
        compact && s.compact,
      ]}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${date}`}
        style={({ pressed }) => [compact ? s.compactOpen : undefined, pressed && s.pressed]}
      >
        <View>
          <EventArtwork event={event} compact={compact} />
          {!compact ? (
            <>
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(15,23,42,0)", "rgba(15,23,42,0.28)"]}
                style={s.artScrim}
              />
              <View style={s.artBadges} pointerEvents="none">
                <View style={s.glassPill}>
                  <View style={[s.dot, { backgroundColor: accent }]} />
                  <Text style={s.glassPillText} numberOfLines={1}>
                    {classification.subcategory === "otro"
                      ? t(`cat.main.${classification.category}`)
                      : t(`cat.sub.${classification.subcategory}`)}
                  </Text>
                </View>
                {free ? (
                  <View style={[s.glassPill, s.freePill]}>
                    <Text style={[s.glassPillText, s.freePillText]}>{t("events.free")}</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
        <View
          style={[
            s.body,
            { backgroundColor: colors.surface },
            compact && s.compactBody,
          ]}
        >
          {compact ? <View style={s.categoryRow}>
            <View
              style={[s.categoryTag, { backgroundColor: `${accent}14` }]}
            >
              <Text style={[s.category, { color: accent }]}>
                {t(`cat.main.${classification.category}`)}
              </Text>
            </View>
            <Text style={[s.subcategory, { color: colors.textMuted }]}>
              {t(`cat.sub.${classification.subcategory}`)}
            </Text>
          </View> : null}
          {!compact ? (
            <Text style={[s.whenText, { color: accent }]} numberOfLines={1}>
              {when}
            </Text>
          ) : null}
          <Text
            numberOfLines={compact ? 2 : 2}
            style={[s.title, { color: colors.text }, compact && s.compactTitle]}
          >
            {event.title}
          </Text>
          {compact ? <View style={[s.meta, s.dateMeta]}>
            <Ionicons
              name="calendar-outline"
              size={15}
              color={colors.primary}
            />
            <Text style={[s.metaText, { color: colors.primary }]}>
              {date}
              {event.starts_at
                ? ` · ${new Date(event.starts_at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}`
                : ""}
              {event.end_date !== event.start_date
                ? ` — ${eventDateLabel({ start_date: event.end_date }, lang)}`
                : ""}
            </Text>
          </View> : null}
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
      <View style={[s.actions, compact && s.compactActions, !compact && { borderTopColor: dark ? colors.borderStrong : "rgba(15,23,42,0.06)" }]}>
        {(social?.count ?? 0) > 0 ? <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={t("events.going", { n: social?.count ?? 0 })}
          style={s.sourceRow}
        >
          <View style={{ flexDirection: "row", paddingRight: 4 }}>
            {(social?.people || []).slice(0, 3).map((person, index) => (
              <View
                key={person.user_id}
                style={{
                  marginLeft: index ? -9 : 0,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: colors.surface,
                }}
              >
                <ProfileAvatar
                  uri={person.avatar_url}
                  name={person.nombre}
                  size={28}
                />
              </View>
            ))}
            {!social?.people.length && (
              <Ionicons
                name="people-outline"
                size={20}
                color={colors.primary}
              />
            )}
          </View>
          <Text
            style={[s.sourceText, { color: colors.textMuted }]}
            numberOfLines={2}
          >
            {t("events.going", { n: social?.count ?? 0 })}
          </Text>
        </Pressable> : <Pressable onPress={onOpen} accessibilityRole="button" style={s.sourceRow}>
          <View style={[s.firstIcon, { backgroundColor: `${accent}1A` }]}>
            <Ionicons name="sparkles" size={14} color={accent} />
          </View>
          <Text style={[s.sourceText, { color: colors.textMuted }]} numberOfLines={1}>
            {t("card.beFirst")}
          </Text>
        </Pressable>}
        <PressScale
          onPress={onJoin}
          disabled={busy || preview}
          accessibilityRole="button"
          accessibilityLabel={joined ? t("events.joined") : t("events.join")}
          style={[
            joined ? actionStyles.joined : actionStyles.button,
            s.join,
            busy && s.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator
              size="small"
              color={joined ? JOINED_PLAN_COLORS.text : "#FFF"}
            />
          ) : joined ? (
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={JOINED_PLAN_COLORS.text}
            />
          ) : null}
          <Text
            style={[joined ? actionStyles.joinedLabel : actionStyles.label]}
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
    marginBottom: 20,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth * 2,
    elevation: 3,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  pressed: { opacity: 0.94 },
  artScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 90 },
  artBadges: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  glassPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    maxWidth: "70%",
  },
  glassPillText: { fontSize: 12, fontWeight: "700", color: "#0F172A" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  freePill: { backgroundColor: "#059669" },
  freePillText: { color: "#FFFFFF" },
  whenText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  firstIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  compact: { borderRadius: 24 },
  compactOpen: { flexDirection: "row", padding: 12, gap: 14 },
  art: { overflow: "hidden", justifyContent: "center", alignItems: "center" },
  artCompact: { width: 98, height: 112, borderRadius: 15 },
  artLarge: { height: 236, width: "100%" },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  compactBody: { padding: 0, paddingTop: 2, flex: 1, marginTop: 0 },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  categoryTag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  category: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  subcategory: { fontSize: 11, fontWeight: "700" },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  compactTitle: {
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  meta: { flexDirection: "row", gap: 5, alignItems: "center" },
  metaText: { fontSize: 14, fontWeight: "600", flex: 1 },
  dateMeta: { marginBottom: 8 },
  actions: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  compactActions: { marginHorizontal: 12, paddingTop: 0, paddingBottom: 14, borderTopWidth: 0 },
  sourceRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sourceIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    minWidth: 0,
    fontWeight: "600",
  },
  join: { flexShrink: 0, minHeight: 44 },
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
