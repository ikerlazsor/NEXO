import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import { useAuthSession } from "../../lib/authSession";
import { Alert } from "../../lib/nexoAlert";
import { getPublicProfiles } from "../../lib/profileData";
import { supabase } from "../../lib/supabase";
import {
  fetchEventMessages,
  reportEventMessage,
  sendEventMessage,
} from "../../features/events/api";
import type { EventMessage } from "../../features/events/types";
import { eventStyles as s } from "../../features/events/EventCards";
export default function EventChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t, lang } = useT();
  const { userId } = useAuthSession();
  const [messages, setMessages] = useState<EventMessage[]>([]),
    [names, setNames] = useState<Record<string, string>>({}),
    [text, setText] = useState(""),
    [member, setMember] = useState(false),
    [failed, setFailed] = useState(false),
    [sending, setSending] = useState(false),
    [more, setMore] = useState(false);
  const active = useRef(false),
    fetching = useRef(false),
    pending = useRef<{ id: string; body: string } | null>(null),
    generation = useRef(0),
    browsingOlder = useRef(false);
  const refresh = useCallback(
    async (older?: EventMessage) => {
      if (!userId || fetching.current) return;
      fetching.current = true;
      const epoch = generation.current;
      try {
        const own = await supabase
          .from("external_event_participants")
          .select("event_id")
          .eq("event_id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (own.error) throw own.error;
        if (!active.current || epoch !== generation.current) return;
        setMember(!!own.data);
        if (!own.data) {
          setMessages([]);
          return;
        }
        const page = await fetchEventMessages(id, older);
        if (older) browsingOlder.current = true;
        if (!active.current || epoch !== generation.current) return;
        const profiles = await getPublicProfiles([
          ...new Set(page.map((m) => m.sender_id)),
        ]);
        if (!active.current || epoch !== generation.current) return;
        setNames((previous) => ({
          ...previous,
          ...Object.fromEntries(
            profiles.map((p) => [p.id, p.nombre || "Nexo"]),
          ),
        }));
        setMessages((previous) =>
          older
            ? [
                ...previous,
                ...page.filter((m) => !previous.some((x) => x.id === m.id)),
              ]
            : page,
        );
        setMore(page.length === 40);
        setFailed(false);
      } catch {
        if (active.current && epoch === generation.current) setFailed(true);
      } finally {
        fetching.current = false;
      }
    },
    [id, userId],
  );
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      generation.current++;
      setMessages([]);
      setMember(false);
      setNames({});
      browsingOlder.current = false;
      void refresh();
      const timer = setInterval(() => {
        if (AppState.currentState === "active" && !browsingOlder.current)
          void refresh();
      }, 10000);
      return () => {
        active.current = false;
        generation.current++;
        clearInterval(timer);
      };
    }, [refresh]),
  );
  const send = async () => {
    if (!text.trim() || !userId || sending) return;
    setSending(true);
    const body = text.trim();
    if (pending.current?.body !== body)
      pending.current = { id: Crypto.randomUUID(), body };
    try {
      await sendEventMessage(id, pending.current.id, body);
      pending.current = null;
      browsingOlder.current = false;
      setText("");
      await refresh();
    } catch {
      Alert.alert(t("feed.error"), t("events.sentFailed"));
    } finally {
      setSending(false);
    }
  };
  const report = (message: EventMessage) => {
    if (!userId) return;
    Alert.alert(t("events.report"), t("events.reportReason"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("events.report"),
        onPress: () => {
          void reportEventMessage(message.id, userId, t("events.reportReason"))
            .then(() => Alert.alert(t("events.reportSent")))
            .catch(() => Alert.alert(t("events.error")));
        },
      },
    ]);
  };
  return (
    <SafeAreaView
      style={[s.screen, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={{ padding: 16 }}>
        <Pressable onPress={() => router.back()}>
          <Text style={[s.link, { color: colors.primary }]}>
            ‹ {t("common.back")}
          </Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>
          {t("events.chat")}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
          {t("events.socialNotice")}
        </Text>
      </View>
      {failed && (
        <Pressable onPress={() => void refresh()}>
          <Text style={{ color: colors.danger, padding: 16 }}>
            {t("events.error")} · {t("events.retry")}
          </Text>
        </Pressable>
      )}
      {!member ? (
        <View style={{ padding: 24 }}>
          <Text style={{ color: colors.textMuted }}>
            {t("events.chatNotice")}
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <FlatList
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16 }}
            ListFooterComponent={
              more ? (
                <Pressable
                  onPress={() => void refresh(messages[messages.length - 1])}
                >
                  <Text style={[s.link, { color: colors.primary }]}>
                    {t("events.older")}
                  </Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                onLongPress={() => report(item)}
                style={{
                  alignSelf:
                    item.sender_id === userId ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  borderRadius: 18,
                  backgroundColor:
                    item.sender_id === userId
                      ? colors.primarySoft
                      : colors.surface,
                  marginBottom: 10,
                  padding: 14,
                }}
              >
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/user-profile/[id]",
                      params: { id: item.sender_id },
                    })
                  }
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: colors.primary,
                      marginBottom: 6,
                    }}
                  >
                    {names[item.sender_id] || "Nexo"}
                  </Text>
                </Pressable>
                <Text
                  selectable
                  style={{ fontSize: 16, lineHeight: 23, color: colors.text }}
                >
                  {item.body}
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    color: colors.textMuted,
                    alignSelf: "flex-end",
                    marginTop: 4,
                  }}
                >
                  {new Date(item.created_at).toLocaleTimeString(lang, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
            )}
          />
          <View
            style={{
              flexDirection: "row",
              padding: 12,
              gap: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              alignItems: "center",
            }}
          >
            <TextInput
              accessibilityLabel={t("events.message")}
              value={text}
              onChangeText={setText}
              editable={!sending}
              maxLength={2000}
              multiline
              placeholder={t("events.message")}
              placeholderTextColor={colors.textMuted}
              style={{
                flex: 1,
                maxHeight: 120,
                borderRadius: 20,
                backgroundColor: colors.surface,
                padding: 14,
                color: colors.text,
              }}
            />
            <Pressable
              disabled={sending || !text.trim()}
              onPress={() => void send()}
              accessibilityRole="button"
            >
              <Text
                style={{
                  fontWeight: "700",
                  color: colors.primary,
                  opacity: sending || !text.trim() ? 0.4 : 1,
                }}
              >
                {t("events.send")}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
