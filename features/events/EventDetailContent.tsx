import { useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Dimensions, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import { getCategoryColor } from "../../lib/categories";
import { emitHeartBurst } from "../../lib/heartBurst";
import { hapticLight } from "../../lib/haptics";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { BounceHeart } from "../../components/BounceHeart";
import { PressScale } from "../../components/PressScale";
import { EventArtwork, isFreeEvent } from "./EventCards";
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
  /** Mismas acciones que un plan de Nexo: compartir, guardar y denunciar. */
  saved?: boolean;
  onShare?: () => void;
  onToggleSave?: () => void;
  onReport?: () => void;
};

const HERO_H = Math.round(Dimensions.get("window").height * 0.42);
const SHEET_OVERLAP = 26;

/** Cached content paints immediately; the offscreen native map is demand mounted. */
export function EventDetailContent({ event, people, signedIn, morePeople, unavailable, error,
  onBack, onRetry, onOfficial, onPerson, onAccount, onMorePeople, renderMap,
  saved = false, onShare, onToggleSave, onReport }: Props) {
  const { colors, scheme } = useAppTheme();
  const { t, lang } = useT();
  const dark = scheme === "dark";
  const [mapVisible, setMapVisible] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutClamped, setAboutClamped] = useState(false);
  const heartHostRef = useRef<View>(null);
  const viewport = useRef({ height: 0, offset: 0, bodyTop: HERO_H, mapTop: Infinity, seen: false });
  const checkMapVisible = () => {
    const view = viewport.current;
    if (!view.seen && view.height > 0 && view.bodyTop + view.mapTop < view.offset + view.height) {
      view.seen = true;
      setMapVisible(true);
    }
  };
  const { category } = eventClassification(event);
  const accent = getCategoryColor(category);
  const free = isFreeEvent(event.price_text);
  const start = event.starts_at ? new Date(event.starts_at) : null;
  const dateRaw = (start || new Date(`${event.start_date}T12:00:00Z`)).toLocaleDateString(lang, {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid",
  });
  const date = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);
  const time = start?.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) || event.schedule;
  const sectionTitle = [s.sectionTitle, { color: colors.text }];
  const glass = { backgroundColor: dark ? "rgba(15,23,42,0.72)" : "rgba(255,255,255,0.92)" };
  const iconColor = dark ? "#F8FAFC" : "#0F172A";
  const openMaps = () => {
    const q = encodeURIComponent([event.venue, event.address].filter(Boolean).join(", "));
    const url = event.latitude != null && event.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
    hapticLight();
    void Linking.openURL(url).catch(() => {});
  };
  return <ScrollView
    contentContainerStyle={s.content}
    scrollEventThrottle={32}
    showsVerticalScrollIndicator={false}
    onLayout={e => { viewport.current.height = e.nativeEvent.layout.height; checkMapVisible(); }}
    onScroll={e => { viewport.current.offset = e.nativeEvent.contentOffset.y; checkMapVisible(); }}
  >
    <View style={s.hero}>
      <EventArtwork event={event} style={s.artwork} />
      <LinearGradient pointerEvents="none" colors={["rgba(15,23,42,0.35)", "rgba(15,23,42,0)"]} style={s.topScrim} />
      <LinearGradient pointerEvents="none" colors={["rgba(15,23,42,0)", "rgba(15,23,42,0.45)"]} style={s.bottomScrim} />
      <PressScale onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")}
        style={[s.roundBtn, s.back, glass]} pressedScale={0.9} minTouch={false}>
        <Ionicons name="chevron-back" size={24} color={iconColor} />
      </PressScale>
      <View style={s.heroActions}>
        {onShare && <PressScale onPress={() => { hapticLight(); onShare(); }} accessibilityRole="button" accessibilityLabel={t("card.share")}
          style={[s.roundBtn, glass]} pressedScale={0.88} minTouch={false}>
          <Ionicons name="share-outline" size={19} color={iconColor} />
        </PressScale>}
        {onToggleSave && <View ref={heartHostRef} collapsable={false} style={[s.roundBtn, glass]}>
          <BounceHeart
            saved={saved}
            size={19}
            color={iconColor}
            savedColor={iconColor}
            onPress={() => {
              if (!saved && signedIn) {
                requestAnimationFrame(() => {
                  heartHostRef.current?.measureInWindow((x, y, w, h) => emitHeartBurst(x + w / 2, y + h / 2));
                });
              }
              onToggleSave();
            }}
          />
        </View>}
        {onReport && <PressScale onPress={onReport} accessibilityRole="button" accessibilityLabel={t("report.planTitle")}
          style={[s.roundBtn, glass]} pressedScale={0.88} minTouch={false}>
          <Ionicons name="alert-circle-outline" size={19} color={iconColor} />
        </PressScale>}
      </View>
      <View style={s.heroPills} pointerEvents="none">
        {free &&<View style={[s.pill, { backgroundColor: "#059669" }]}>
          <Text style={[s.pillText, { color: "#FFF" }]}>{t("events.free")}</Text>
        </View>}
      </View>
    </View>
    <View style={[s.body, { backgroundColor: colors.background }]}
      onLayout={e => { viewport.current.bodyTop = e.nativeEvent.layout.y; checkMapVisible(); }}>
      <Text accessibilityRole="header" style={[s.title, { color: colors.text }]}>{event.title}</Text>
      {!free && !!event.price_text && <Text style={[s.price, { color: colors.textMuted }]} numberOfLines={2}>{event.price_text}</Text>}
      {unavailable && <Text style={[s.notice, { color: colors.text, backgroundColor: colors.warningSoft }]}>{t("events.cancelled")}</Text>}
      {error && <Pressable onPress={onRetry} accessibilityRole="button">
        <Text style={{ color: colors.primary, lineHeight: 21 }}>{t("events.unavailable")} · {t("events.retry")}</Text>
      </Pressable>}

      <View style={[s.facts, { backgroundColor: colors.surface, borderColor: dark ? colors.borderStrong : "rgba(15,23,42,0.06)" }]}>
        <View style={s.factRow}>
          <View style={[s.factIcon, { backgroundColor: `${accent}18` }]}><Ionicons name="calendar" size={20} color={accent} /></View>
          <View style={s.factText}>
            <Text style={[s.factMain, { color: colors.text }]}>{date}</Text>
            {!!time && <Text style={[s.factSecondary, { color: colors.textMuted }]}>{time}</Text>}
          </View>
        </View>
        <View style={[s.divider, { backgroundColor: dark ? colors.borderStrong : "rgba(15,23,42,0.07)" }]} />
        <Pressable onPress={openMaps} accessibilityRole="link" style={({ pressed }) => [s.factRow, pressed && { opacity: 0.7 }]}>
          <View style={[s.factIcon, { backgroundColor: `${accent}18` }]}><Ionicons name="location" size={20} color={accent} /></View>
          <View style={s.factText}>
            <Text style={[s.factMain, { color: colors.text }]}>{event.venue}</Text>
            {!!event.address && <Text style={[s.factSecondary, { color: colors.textMuted }]}>{event.address}</Text>}
          </View>
          <Ionicons name="navigate-outline" size={18} color={colors.primary} />
        </Pressable>
      </View>

      <View style={s.section}>
        <View style={s.sectionHead}>
          <Text accessibilityRole="header" style={sectionTitle}>{t("events.people")}</Text>
          {signedIn && people.length > 0 && <Text style={[s.count, { color: colors.textMuted }]}>{t("events.going", { n: people.length })}</Text>}
        </View>
        {!signedIn ? <Pressable onPress={onAccount} accessibilityRole="button">
          <Text style={[s.link, { color: colors.primary }]}>{t("events.seePeople")}</Text>
        </Pressable> : people.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.people}>
          {people.map(p => <Pressable key={p.user_id} onPress={() => onPerson(p.user_id)}
            accessibilityRole="button" accessibilityLabel={p.nombre} style={({ pressed }) => [s.person, pressed && { opacity: 0.75 }]}>
            <View style={[s.avatarRing, { borderColor: `${accent}55` }]}>
              <ProfileAvatar uri={p.avatar_url} name={p.nombre} size={56} />
            </View>
            <Text numberOfLines={1} style={[s.personName, { color: colors.text }]}>{p.nombre}</Text>
          </Pressable>)}
          {morePeople && <Pressable onPress={onMorePeople} accessibilityRole="button" style={s.person}>
            <View style={[s.morePeople, { backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
            </View>
            <Text numberOfLines={1} style={[s.personName, { color: colors.textMuted }]}>{t("events.morePeople")}</Text>
          </Pressable>}
        </ScrollView> : <View style={[s.openGroup, { backgroundColor: `${accent}12` }]}>
          <View style={[s.openGroupIcon, { backgroundColor: `${accent}22` }]}>
            <Ionicons name="people" size={18} color={accent} />
          </View>
          <Text style={[s.openGroupText, { color: colors.text }]}>{t("events.peopleEmpty")}</Text>
        </View>}
      </View>

      {!!event.description && <View style={s.section}>
        <Text accessibilityRole="header" style={sectionTitle}>{t("events.about")}</Text>
        <Text
          style={[s.paragraph, { color: colors.text }]}
          numberOfLines={aboutOpen ? undefined : 6}
          onTextLayout={e => { if (!aboutOpen && e.nativeEvent.lines.length >= 6) setAboutClamped(true); }}
        >
          {event.description}
        </Text>
        {aboutClamped && <Pressable onPress={() => { hapticLight(); setAboutOpen(o => !o); }} accessibilityRole="button" hitSlop={8}>
          <Text style={[s.link, { color: colors.primary }]}>{t(aboutOpen ? "events.readLess" : "events.readMore")}</Text>
        </Pressable>}
      </View>}

      <PressScale onPress={onOfficial} accessibilityRole="link" pressedScale={0.98} minTouch={false}
        style={[s.source, { backgroundColor: colors.surface, borderColor: dark ? colors.borderStrong : "rgba(15,23,42,0.08)" }]}>
        <View style={[s.factIcon, { backgroundColor: colors.surfaceSubtle }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
        </View>
        <Text style={[s.sourceText, { color: colors.text }]}>{t("events.detailsAndBooking")}</Text>
        <Ionicons name="open-outline" size={18} color={colors.textMuted} />
      </PressScale>

      <View onLayout={e => { viewport.current.mapTop = e.nativeEvent.layout.y; checkMapVisible(); }}>
        {renderMap(mapVisible)}
      </View>
      <View style={[s.credits, { borderTopColor: dark ? colors.borderStrong : "rgba(15,23,42,0.08)" }]}>
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
  hero: { height: HERO_H + SHEET_OVERLAP, overflow: "hidden" },
  artwork: { height: "100%", width: "100%" },
  topScrim: { position: "absolute", left: 0, right: 0, top: 0, height: 110 },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 140 },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  back: { position: "absolute", left: 16, top: 14, width: 42, height: 42, borderRadius: 21 },
  heroActions: { position: "absolute", right: 16, top: 14, flexDirection: "row", gap: 10 },
  heroPills: { position: "absolute", left: 18, bottom: SHEET_OVERLAP + 14, flexDirection: "row", gap: 8 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 999, backgroundColor: "rgba(255,255,255,0.94)",
  },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "800", color: "#0F172A" },
  body: {
    marginTop: -SHEET_OVERLAP, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 22, gap: 18,
  },
  title: { fontSize: 26, lineHeight: 32, letterSpacing: -0.6, fontWeight: "900" },
  price: { fontSize: 13, fontWeight: "600", marginTop: -8 },
  notice: { padding: 14, borderRadius: 16, lineHeight: 21, overflow: "hidden" },
  facts: { padding: 14, borderRadius: 22, gap: 12, borderWidth: StyleSheet.hairlineWidth * 2 },
  factRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  factIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  factText: { flex: 1, gap: 2 },
  factMain: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  factSecondary: { fontSize: 13, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth * 2, marginLeft: 54 },
  section: { gap: 12, paddingTop: 2 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: "800", letterSpacing: -0.3 },
  count: { fontSize: 13, fontWeight: "700" },
  paragraph: { fontSize: 15, lineHeight: 23 },
  people: { gap: 14, paddingRight: 8 },
  person: { alignItems: "center", width: 66, gap: 6 },
  avatarRing: { borderWidth: 2, borderRadius: 32, padding: 2 },
  morePeople: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  personName: { fontSize: 12, fontWeight: "600", maxWidth: 66 },
  openGroup: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18 },
  openGroupIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  openGroupText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  source: {
    minHeight: 60, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 18, paddingHorizontal: 12,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  sourceText: { flex: 1, fontSize: 15, fontWeight: "700" },
  link: { fontSize: 14, fontWeight: "700", lineHeight: 22 },
  credits: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 8, gap: 8 },
  creditLinks: { flexDirection: "row", gap: 16 },
});
