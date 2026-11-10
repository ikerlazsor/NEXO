import { useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import { getCategoryColor } from "../../lib/categories";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { EventArtwork } from "./EventCards";
import { eventClassification } from "./covers";
import type { ExternalEvent, EventPerson } from "./types";

type Props = {
  event: ExternalEvent;
  people: EventPerson[];
  signedIn: boolean;
  morePeople: boolean;
  unavailable: boolean;
  error: boolean;
  onBack: () => void;
  onRetry: () => void;
  onOfficial: () => void;
  onPerson: (id: string) => void;
  onAccount: () => void;
  onMorePeople: () => void;
  renderMap: (visible: boolean) => ReactNode;
};

/** Cached content paints immediately; the offscreen native map is demand mounted. */
export function EventDetailContent({ event, people, signedIn, morePeople, unavailable, error,
  onBack, onRetry, onOfficial, onPerson, onAccount, onMorePeople, renderMap }: Props) {
  const { colors } = useAppTheme();
  const { t, lang } = useT();
  const [mapVisible, setMapVisible] = useState(false);
  const viewport = useRef({ height: 0, offset: 0, bodyTop: 238, mapTop: Infinity, seen: false });
  const checkMapVisible = () => {
    const view = viewport.current;
    if (!view.seen && view.height > 0 && view.bodyTop + view.mapTop < view.offset + view.height) {
      view.seen = true;
      setMapVisible(true);
    }
  };
  const category = eventClassification(event).category;
  const accent = getCategoryColor(category);
  const start = event.starts_at ? new Date(event.starts_at) : null;
  const date = (start || new Date(`${event.start_date}T12:00:00Z`)).toLocaleDateString(lang, {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid",
  });
  const time = start?.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) || event.schedule;
  const sectionTitle = [s.sectionTitle, { color: colors.text }];
  return <ScrollView
    contentContainerStyle={s.content}
    scrollEventThrottle={32}
    onLayout={e => { viewport.current.height = e.nativeEvent.layout.height; checkMapVisible(); }}
    onScroll={e => { viewport.current.offset = e.nativeEvent.contentOffset.y; checkMapVisible(); }}
  >
    <View style={s.hero}>
      <EventArtwork event={event} style={s.artwork} />
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")}
        style={[s.back, { backgroundColor: colors.surface }]} hitSlop={8}>
        <Ionicons name="arrow-back" size={23} color={colors.text} />
      </Pressable>
    </View>
    <View style={s.body} onLayout={e => { viewport.current.bodyTop = e.nativeEvent.layout.y; checkMapVisible(); }}>
      <View style={s.categoryRow}>
        <View style={[s.category, { backgroundColor: `${accent}18` }]}>
          <View style={[s.categoryDot, { backgroundColor: accent }]} />
          <Text style={[s.categoryLabel, { color: colors.text }]}>{t(`cat.main.${category}`)}</Text>
        </View>
        {event.price_text && <Text style={[s.price, { color: colors.textMuted }]}>{event.price_text}</Text>}
      </View>
      <Text accessibilityRole="header" style={[s.title, { color: colors.text }]}>{event.title}</Text>
      {unavailable && <Text style={[s.notice, { color: colors.text, backgroundColor: colors.warningSoft }]}>{t("events.cancelled")}</Text>}
      {error && <Pressable onPress={onRetry} accessibilityRole="button">
        <Text style={{ color: colors.primary, lineHeight: 21 }}>{t("events.unavailable")} · {t("events.retry")}</Text>
      </Pressable>}
      <View style={[s.facts, { backgroundColor: colors.surfaceSubtle }]}>
        <View style={s.factRow}>
          <View style={[s.factIcon, { backgroundColor: colors.surface }]}><Ionicons name="calendar-outline" size={21} color={colors.primary} /></View>
          <View style={s.factText}>
            <Text style={[s.factMain, { color: colors.text }]}>{date}</Text>
            {!!time && <Text style={[s.factSecondary, { color: colors.textMuted }]}>{time}</Text>}
          </View>
        </View>
        <View style={[s.divider, { backgroundColor: colors.borderStrong }]} />
        <View style={s.factRow}>
          <View style={[s.factIcon, { backgroundColor: colors.surface }]}><Ionicons name="location-outline" size={21} color={colors.primary} /></View>
          <View style={s.factText}>
            <Text style={[s.factMain, { color: colors.text }]}>{event.venue}</Text>
            {!!event.address && <Text style={[s.factSecondary, { color: colors.textMuted }]}>{event.address}</Text>}
          </View>
        </View>
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={sectionTitle}>{t("events.people")}</Text>
        {!signedIn ? <Pressable onPress={onAccount} accessibilityRole="button">
          <Text style={[s.link, { color: colors.primary }]}>{t("events.seePeople")}</Text>
        </Pressable> : people.length ? <View style={s.people}>
          {people.map(p => <Pressable key={p.user_id} onPress={() => onPerson(p.user_id)}
            accessibilityRole="button" accessibilityLabel={p.nombre} style={s.person}>
            <ProfileAvatar uri={p.avatar_url} size={52} />
            <Text numberOfLines={1} style={[s.personName, { color: colors.text }]}>{p.nombre}</Text>
          </Pressable>)}
        </View> : <Text style={[s.paragraph, { color: colors.textMuted }]}>{t("events.peopleEmpty")}</Text>}
        {morePeople && <Pressable onPress={onMorePeople} accessibilityRole="button">
          <Text style={[s.link, { color: colors.primary }]}>{t("events.morePeople")}</Text>
        </Pressable>}
      </View>
      {!!event.description && <View style={s.section}>
        <Text accessibilityRole="header" style={sectionTitle}>{t("events.about")}</Text>
        <Text style={[s.paragraph, { color: colors.text }]}>{event.description}</Text>
      </View>}
      <Pressable accessibilityRole="link" onPress={onOfficial} style={[s.source, { borderColor: colors.borderStrong }]}>
        <Text style={[s.link, { color: colors.primary, flex: 1 }]}>{t("events.detailsAndBooking")}</Text>
        <Ionicons name="open-outline" size={19} color={colors.primary} />
      </Pressable>
      <View onLayout={e => { viewport.current.mapTop = e.nativeEvent.layout.y; checkMapVisible(); }}>
        {renderMap(mapVisible)}
      </View>
      <View style={[s.credits, { borderTopColor: colors.borderStrong }]}>
        <View style={s.creditLinks}>
          <Pressable onPress={() => { void Linking.openURL(event.provider_id === "madrid"
            ? "https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100" : event.source_url).catch(() => {}); }} accessibilityRole="link">
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>{t("events.license")}</Text>
          </Pressable>
          {event.provider_id === "madrid" && <Pressable onPress={() => { void Linking.openURL("https://creativecommons.org/licenses/by/4.0/").catch(() => {}); }} accessibilityRole="link">
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>CC BY 4.0</Text>
          </Pressable>}
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>{t("events.dataAdapted")}</Text>
      </View>
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({
  content: { paddingBottom: 24 },
  hero: { height: 238, overflow: "hidden" },
  artwork: { height: "100%", width: "100%" },
  back: { position: "absolute", left: 18, top: 16, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 22, paddingTop: 22, gap: 20 },
  categoryRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 },
  category: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  categoryDot: { width: 7, height: 7, borderRadius: 4 },
  categoryLabel: { fontSize: 12, fontWeight: "700" },
  price: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6, fontWeight: "800" },
  notice: { padding: 14, borderRadius: 16, lineHeight: 21 },
  facts: { padding: 16, borderRadius: 22, gap: 14 },
  factRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  factIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  factText: { flex: 1, gap: 4 },
  factMain: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  factSecondary: { fontSize: 13, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
  section: { gap: 12, paddingTop: 4 },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.3 },
  paragraph: { fontSize: 15, lineHeight: 24 },
  people: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  person: { alignItems: "center", width: 62, gap: 6 },
  personName: { fontSize: 12, fontWeight: "500", maxWidth: 62 },
  source: { minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  link: { fontSize: 14, fontWeight: "700", lineHeight: 22 },
  credits: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 8, gap: 8 },
  creditLinks: { flexDirection: "row", gap: 16 },
});
