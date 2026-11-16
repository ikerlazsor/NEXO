import { useCallback, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import { useAuthSession } from "../../lib/authSession";
import { Alert } from "../../lib/nexoAlert";
import {
  eventStyles as s,
} from "../../features/events/EventCards";
import {
  fetchEvent,
  fetchEventMembership,
  fetchEventPeople,
  setEventMembership,
  trackEvent,
  eventJoinErrorKey,
} from "../../features/events/api";
import type { ExternalEvent, EventPerson } from "../../features/events/types";
import { EventLocationMap } from "../../features/events/EventLocationMap";
import { publishEventMembership } from "../../features/events/membershipBus";
import { hapticError, hapticSuccess } from "../../lib/haptics";
import { toggleEventSaved, useSavedEventIds } from "../../features/events/savedEvents";
import { FeedHeartBurstHost } from "../../components/FeedHeartBurstHost";
import { peekEvent, peekEventSocial } from "../../features/events/cache";
import { EventDetailContent } from "../../features/events/EventDetailContent";
import { useScreenTransitionReady } from "../../hooks/useScreenTransitionReady";
import { PressScale } from "../../components/PressScale";
import { JOINED_PLAN_COLORS, planCardActionStyles } from "../../components/planCardActions";
import { eventWhenLabel } from "../../features/events/EventCards";
import { shareEventLink } from "../../lib/shareEvent";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function EventDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { colors, scheme } = useAppTheme();
  const actionStyles = planCardActionStyles(scheme === 'dark');
  const { t, lang } = useT();
  const transitionReady = useScreenTransitionReady();
  const { userId, requireAccount } = useAuthSession();
  const scope = JSON.stringify([id, userId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [storedEvent, setEvent] = useState<ExternalEvent | null>(() => peekEvent(id)),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true);
  const [storedPeople, setPeople] = useState<EventPerson[]>(() => peekEventSocial(userId, id)?.people ?? []),
    [storedMorePeople, setMorePeople] = useState(false),
    [storedJoined, setJoined] = useState(() => peekEventSocial(userId, id)?.joined ?? false),
    [privateScope, setPrivateScope] = useState(scope),
    [busyScope, setBusyScope] = useState<string | null>(null);
  const event = storedEvent?.id === id ? storedEvent : null;
  const people = privateScope === scope ? storedPeople : [];
  const morePeople = privateScope === scope && storedMorePeople;
  const joined = privateScope === scope && storedJoined;
  const busy = busyScope === scope;
  // Mismo estado que la tarjeta del feed (guardar en uno se ve en el otro).
  const savedIds = useSavedEventIds(userId ?? null);
  const saved = !!userId && savedIds.has(id);
  const toggleSave = async () => {
    if (!userId) {
      requireAccount({ type: "event", eventId: id });
      return;
    }
    const ok = await toggleEventSaved(id);
    if (!ok) Alert.alert(t("feed.error"), t("events.error"));
  };
  const shareEvent = () => {
    if (!event) return;
    void shareEventLink({
      eventId: event.id,
      title: event.title,
      when: eventWhenLabel(event, lang),
      venue: event.venue,
    });
  };
  const reportEvent = () => {
    if (!userId) {
      requireAccount({ type: "event", eventId: id });
      return;
    }
    router.push({ pathname: "/report-plan", params: { eventId: id } });
  };
  const loadedPrivateScope = useRef(scope);
  const personLoading = useRef<object | null>(null),
    mutation = useRef<object | null>(null),
    request = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      if (currentScope.current !== scope) return;
      const version = ++epoch.current;
      request.current?.abort();
      const abort = new AbortController();
      request.current = abort;
      const timeout = setTimeout(() => abort.abort(), 12000);
      const current = () =>
        version === epoch.current &&
        currentScope.current === scope &&
        !abort.signal.aborted;
      setError(false);
      if (!quiet) setLoading(true);
      setPrivateScope(scope);
      if (loadedPrivateScope.current !== scope) {
        loadedPrivateScope.current = scope;
        setPeople([]);
        setMorePeople(false);
        setJoined(false);
      }
      personLoading.current = null;
      try {
        if (!UUID.test(id)) throw new Error("invalid_id");
        const detailsRequest = fetchEvent(id, abort.signal);
        const socialRequest = userId ? Promise.allSettled([
          fetchEventPeople(id, undefined, abort.signal),
          fetchEventMembership(id, userId, abort.signal),
        ]) : null;
        const item = await detailsRequest;
        if (abort.signal.aborted) throw new Error("request_aborted");
        if (!current()) return;
        setEvent(item);
        if (userId) {
          const [members, own] = await socialRequest!;
          if (abort.signal.aborted) throw new Error("request_aborted");
          if (!current()) return;
          if (own.status === "fulfilled") setJoined(own.value);
          if (members.status === "fulfilled") {
            setPeople(members.value);
            setMorePeople(members.value.length === 30);
          }
          if (own.status === "rejected" || members.status === "rejected")
            setError(true);
          void trackEvent(id, "view");
        }
      } catch {
        if (version === epoch.current && currentScope.current === scope)
          setError(true);
      } finally {
        clearTimeout(timeout);
        if (version === epoch.current && currentScope.current === scope)
          setLoading(false);
      }
    },
    [id, userId, scope],
  );
  useFocusEffect(
    useCallback(() => {
      if (!transitionReady) return;
      setBusyScope(null);
      void load(!!peekEvent(id));
      return () => {
        epoch.current++;
        request.current?.abort();
        personLoading.current = null;
        mutation.current = null;
      };
    }, [load, id, transitionReady]),
  );
  const unavailable =
    event?.status !== "active" ||
    (!!event?.starts_at && Date.parse(event.starts_at) <= Date.now()) ||
    (!!event &&
      event.end_date <
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Madrid",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()));
  const changeMembership = async () => {
    if (currentScope.current !== scope) return;
    if (!userId) {
      requireAccount({ type: "event", eventId: id });
      return;
    }
    if (mutation.current) return;
    const operation = {};
    mutation.current = operation;
    setBusyScope(scope);
    try {
      await setEventMembership(id, !joined);
      if (currentScope.current === scope) {
        setJoined(!joined);
        publishEventMembership({ userId, eventId: id, joined: !joined });
        hapticSuccess();
      }
      if (currentScope.current === scope && mutation.current === operation)
        await load(true);
    } catch (error) {
      if (currentScope.current === scope && mutation.current === operation) {
        hapticError();
        Alert.alert(t("feed.error"), t(eventJoinErrorKey(error)));
      }
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        setBusyScope(null);
      }
    }
  };
  const askJoin = () => {
    if (!userId) {
      requireAccount({ type: "event", eventId: id });
      return;
    }
    if (!joined) {
      void changeMembership();
      return;
    }
    Alert.alert(
      t("feed.leaveTitle"),
      t("feed.leaveMsg"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t(joined ? "events.leave" : "events.join"),
          style: "destructive",
          onPress: () => void changeMembership(),
        },
      ],
    );
  };
  const openOfficial = async () => {
    if (!event || currentScope.current !== scope) return;
    try {
      const url = new URL(event.source_url);
      if (url.protocol !== "https:") throw new Error("url");
      await Linking.openURL(url.toString());
      if (userId && currentScope.current === scope)
        void trackEvent(event.id, "official");
    } catch {
      Alert.alert(t("feed.error"), t("events.error"));
    }
  };
  const loadPeople = async () => {
    if (
      personLoading.current ||
      !morePeople ||
      !userId ||
      currentScope.current !== scope
    )
      return;
    const operation = {};
    personLoading.current = operation;
    const version = epoch.current;
    try {
      const page = await fetchEventPeople(id, people[people.length - 1]);
      if (version !== epoch.current || currentScope.current !== scope) return;
      setPeople((prev) => [
        ...prev,
        ...page.filter((p) => !prev.some((x) => x.user_id === p.user_id)),
      ]);
      setMorePeople(page.length === 30);
    } catch {
      if (version === epoch.current && currentScope.current === scope)
        Alert.alert(t("feed.error"), t("events.error"));
    } finally {
      if (personLoading.current === operation) personLoading.current = null;
    }
  };
  return (
    <SafeAreaView
      style={[s.screen, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      {event ? <EventDetailContent
        key={id}
        event={event}
        people={people}
        signedIn={!!userId}
        morePeople={morePeople}
        unavailable={unavailable}
        error={error}
        onBack={() => router.canGoBack() ? router.back() : router.replace("/")}
        onRetry={() => void load()}
        onOfficial={() => void openOfficial()}
        onPerson={personId => router.push({ pathname: "/user-profile/[id]", params: { id: personId } })}
        onAccount={() => requireAccount({ type: "event", eventId: id })}
        onMorePeople={() => void loadPeople()}
        renderMap={visible => <EventLocationMap event={event} enabled={visible && transitionReady} />}
        saved={saved}
        onShare={shareEvent}
        onToggleSave={() => void toggleSave()}
        onReport={reportEvent}
      /> : <View style={[s.content, { flex: 1 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} style={s.back}
          onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
          <Text style={{ color: colors.text }}>{t("common.back")}</Text>
        </Pressable>
        {loading && <ActivityIndicator color={colors.primary} />}
        {error && <Pressable onPress={() => void load()} accessibilityRole="button">
          <Text style={[s.paragraph, { color: colors.textMuted }]}>{t("events.unavailable")} · {t("events.retry")}</Text>
        </Pressable>}
      </View>}
      {event && <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', gap: 12 }}>
        <PressScale
          onPress={askJoin}
          disabled={busy || loading || (!joined && unavailable)}
          accessibilityRole="button"
          accessibilityLabel={t(joined ? 'events.leave' : 'events.join')}
          style={[joined ? actionStyles.joined : actionStyles.button, { flex: 1, minHeight: 52, justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: busy || loading || (!joined && unavailable) ? 0.55 : 1 }]}
        >
          {busy ? <ActivityIndicator color={joined ? JOINED_PLAN_COLORS.text : colors.onPrimary} /> : joined ? <Ionicons name="checkmark-circle" size={20} color={JOINED_PLAN_COLORS.text} /> : null}
          <Text style={{ fontSize: 16, fontWeight: '700', color: joined ? JOINED_PLAN_COLORS.text : colors.onPrimary }}>{t(joined ? 'events.joined' : 'events.join')}</Text>
        </PressScale>
        {joined && <PressScale onPress={() => router.push({ pathname: '/event-chat/[id]', params: { id, fromEvent: '1' } })} accessibilityRole="button" accessibilityLabel={t('events.chat')} style={{ width: 54, minHeight: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chatbubbles" size={22} color={colors.onPrimary} />
        </PressScale>}
      </View>}
      <FeedHeartBurstHost />
    </SafeAreaView>
  );
}
