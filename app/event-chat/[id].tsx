import { useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
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
import { reportEventMessage } from "../../features/events/api";
import { useEventChat } from "../../features/events/useEventChat";
import type { EventMessage } from "../../features/events/types";
import { eventStyles as s } from "../../features/events/EventCards";
export default function EventChat() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t, lang } = useT();
  const { userId } = useAuthSession();
  const { messages, names, text, member, failed, sending, more, setText, refresh, send } = useEventChat(id, userId);
  const scope = JSON.stringify([id, userId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sendMessage = async () => {
    try {
      await send();
    } catch {
      if (currentScope.current === scope)
        Alert.alert(t("feed.error"), t("events.sentFailed"));
    }
  };
  const report = (message: EventMessage) => {
    if (!userId) return;
    Alert.alert(t("events.report"), t("events.reportReason"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("events.report"),
        onPress: () => {
          if (currentScope.current !== scope) return;
          void reportEventMessage(message.id, userId, t("events.reportReason"))
            .then(() => { if (currentScope.current === scope) Alert.alert(t("events.reportSent")); })
            .catch(() => { if (currentScope.current === scope) Alert.alert(t("events.error")); });
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
              onPress={() => void sendMessage()}
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
