import { useCallback, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import { useAuthSession } from "../../lib/authSession";
import { Alert } from "../../lib/nexoAlert";
import { supabase } from "../../lib/supabase";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import {
  EventArtwork,
  eventDateLabel,
  eventStyles as s,
} from "../../features/events/EventCards";
import {
  fetchEvent,
  fetchEventPeople,
  setEventMembership,
  trackEvent,
} from "../../features/events/api";
import type { ExternalEvent, EventPerson } from "../../features/events/types";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function EventDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t, lang } = useT();
  const { userId, requireAccount } = useAuthSession();
  const [event, setEvent] = useState<ExternalEvent | null>(null),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<EventPerson[]>([]),
    [morePeople, setMorePeople] = useState(false),
    [joined, setJoined] = useState(false),
    [busy, setBusy] = useState(false);
  const personLoading = useRef(false),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++epoch.current;
    setError(false);
    setLoading(true);
    setPeople([]);
    setJoined(false);
    try {
      if (!UUID.test(id)) throw new Error("invalid_id");
      const item = await fetchEvent(id);
      if (version !== epoch.current) return;
      setEvent(item);
      if (userId) {
        const [members, own] = await Promise.all([
          fetchEventPeople(id),
          supabase
            .from("external_event_participants")
            .select("event_id")
            .eq("event_id", id)
            .eq("user_id", userId)
            .maybeSingle(),
        ]);
        if (version !== epoch.current) return;
        if (own.error) throw own.error;
        setPeople(members);
        setMorePeople(members.length === 30);
        setJoined(!!own.data);
        void trackEvent(id, "view");
      }
    } catch {
      if (version === epoch.current) setError(true);
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [id, userId]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        epoch.current++;
      };
    }, [load]),
  );
  const unavailable =
    event?.status !== "active" ||
    (!!event &&
      event.end_date <
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Madrid",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()));
  const changeMembership = async () => {
    if (!userId) {
      requireAccount({ type: "event", eventId: id });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await setEventMembership(id, !joined);
      await load();
    } catch {
      Alert.alert(t("feed.error"), t("events.error"));
    } finally {
      setBusy(false);
    }
  };
  const askJoin = () => {
    if (!userId) {
      requireAccount({ type: "event", eventId: id });
      return;
    }
    Alert.alert(
      t(joined ? "events.leave" : "events.join"),
      t("events.socialNotice"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t(joined ? "events.leave" : "events.join"),
          onPress: () => void changeMembership(),
        },
      ],
    );
  };
  const openOfficial = async () => {
    try {
      const url = new URL(event!.source_url);
      if (url.protocol !== "https:") throw new Error("url");
      await Linking.openURL(url.toString());
      if (userId) void trackEvent(id, "official");
    } catch {
      Alert.alert(t("feed.error"), t("events.error"));
    }
  };
  const loadPeople = async () => {
    if (personLoading.current || !morePeople) return;
    personLoading.current = true;
    const version = epoch.current;
    try {
      const page = await fetchEventPeople(id, people[people.length - 1]);
      if (version !== epoch.current) return;
      setPeople((prev) => [
        ...prev,
        ...page.filter((p) => !prev.some((x) => x.user_id === p.user_id)),
      ]);
      setMorePeople(page.length === 30);
    } catch {
      Alert.alert(t("feed.error"), t("events.error"));
    } finally {
      personLoading.current = false;
    }
  };
  return (
    <SafeAreaView
      style={[s.screen, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <ScrollView contentContainerStyle={s.content}>
        <Pressable
          accessibilityRole="button"
          style={s.back}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
          <Text style={{ color: colors.text }}>{t("common.back")}</Text>
        </Pressable>
        {loading && <ActivityIndicator color={colors.primary} />}
        {error && (
          <Pressable onPress={() => void load()}>
            <Text style={[s.paragraph, { color: colors.textMuted }]}>
              {t("events.unavailable")} · {t("events.retry")}
            </Text>
          </Pressable>
        )}
        {event && (
          <>
            <View style={{ borderRadius: 24, overflow: "hidden" }}>
              <EventArtwork event={event} />
            </View>
            <Text style={[s.link, { color: colors.primary }]}>
              {t(`cat.main.${event.category}`)} · {t("events.source")}
            </Text>
            <Text style={[s.heading, { color: colors.text }]}>
              {event.title}
            </Text>
            {unavailable && (
              <View style={[s.notice, { backgroundColor: colors.warningSoft }]}>
                <Text style={{ color: colors.text }}>
                  {t("events.cancelled")}
                </Text>
              </View>
            )}
            <Text style={[s.paragraph, { color: colors.text }]}>
              {eventDateLabel(event, lang)}
              {event.end_date !== event.start_date
                ? ` — ${event.end_date}`
                : ""}
            </Text>
            <Text style={{ color: colors.textMuted }}>
              {event.schedule ||
                (event.starts_at
                  ? new Date(event.starts_at).toLocaleTimeString(lang, {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Madrid",
                    })
                  : t("events.dateUnknown"))}
            </Text>
            <View style={s.row}>
              <Ionicons
                name="location-outline"
                size={22}
                color={colors.primary}
              />
              <Text style={{ color: colors.text, flex: 1 }}>
                {event.venue || t("events.venueUnknown")}
              </Text>
            </View>
            {event.description && (
              <Text style={[s.paragraph, { color: colors.text }]}>
                {event.description}
              </Text>
            )}
            <Text style={[s.paragraph, { color: colors.textMuted }]}>
              {event.price_text || t("events.priceUnknown")}
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => void openOfficial()}
              style={s.row}
            >
              <Ionicons name="open-outline" size={18} color={colors.primary} />
              <Text style={[s.link, { color: colors.primary }]}>
                {t("events.official")}
              </Text>
            </Pressable>
            <View style={[s.notice, { backgroundColor: colors.primarySoft }]}>
              <Text style={{ color: colors.text, lineHeight: 21 }}>
                {t("events.socialNotice")}
              </Text>
            </View>
            <Pressable
              disabled={busy || loading || (!joined && unavailable)}
              onPress={askJoin}
              style={[
                s.button,
                {
                  backgroundColor: joined
                    ? colors.surfaceSubtle
                    : colors.primary,
                  opacity: busy || (!joined && unavailable) ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  s.buttonText,
                  { color: joined ? colors.text : colors.onPrimary },
                ]}
              >
                {t(joined ? "events.leave" : "events.join")}
              </Text>
            </Pressable>
            {joined && (
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/event-chat/[id]", params: { id } })
                }
                style={[s.button, { backgroundColor: colors.primarySoft }]}
              >
                <Text style={[s.buttonText, { color: colors.primary }]}>
                  {t("events.chat")}
                </Text>
              </Pressable>
            )}
            <Text style={[s.heading, { color: colors.text, fontSize: 21 }]}>
              {t("events.people")}
            </Text>
            {!userId ? (
              <Pressable
                onPress={() => requireAccount({ type: "event", eventId: id })}
              >
                <Text style={[s.link, { color: colors.primary }]}>
                  {t("events.chatNotice")}
                </Text>
              </Pressable>
            ) : (
              <>
                {!people.length && (
                  <Text style={{ color: colors.textMuted }}>
                    {t("events.peopleEmpty")}
                  </Text>
                )}
                {people.map((p) => (
                  <Pressable
                    key={p.user_id}
                    style={s.row}
                    onPress={() =>
                      router.push({
                        pathname: "/user-profile/[id]",
                        params: { id: p.user_id },
                      })
                    }
                  >
                    <ProfileAvatar uri={p.avatar_url} size={40} />
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      {p.nombre}
                    </Text>
                  </Pressable>
                ))}
                {morePeople && (
                  <Pressable onPress={() => void loadPeople()}>
                    <Text style={[s.link, { color: colors.primary }]}>
                      {t("events.morePeople")}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
            <Text
              style={{ color: colors.textMuted, fontSize: 11, marginTop: 24 }}
            >
              {t("events.source")} · {t("events.updated")}{" "}
              {new Date(event.last_seen_at).toLocaleDateString(lang)}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
