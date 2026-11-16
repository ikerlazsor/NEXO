import { registerRootComponent } from "expo";
import { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useT } from "../../lib/i18n";
import { useAppTheme } from "../../lib/appTheme";
import { EventCard } from "../../features/events/EventCards";
import { EventDetailContent } from "../../features/events/EventDetailContent";
import type { ExternalEvent } from "../../features/events/types";
import {
  previewEvents,
  previewCoverCatalog,
} from "../../features/events/previewData";
function Design() {
  const [catalog, setCatalog] = useState(false);
  const [detail, setDetail] = useState<ExternalEvent | null>(null);
  const examples = useMemo(previewEvents, []);
  const allCovers = useMemo(previewCoverCatalog, []);
  const { t } = useT();
  const { colors } = useAppTheme();
  const events = catalog
    ? allCovers.map((event) => ({
        ...event,
        title: `${t(`cat.main.${event.category}`)} · ${t(`cat.sub.${event.subcategory}`)}`,
      }))
    : examples;
  if (detail) return <View style={{ flex: 1, width: "100%", maxWidth: 520, alignSelf: "center", backgroundColor: colors.background }}>
    <EventDetailContent event={{ ...detail, price_text: "Gratis", description: "Una tarde para practicar idiomas y conocer a otras personas que viven en Madrid. Nos organizaremos en grupos pequeños para conversar, compartir historias y cambiar de idioma." }}
      people={[{ user_id: "synthetic-ana", nombre: "Ana", joined_at: detail.last_seen_at }, { user_id: "synthetic-leo", nombre: "Leo", joined_at: detail.last_seen_at }]}
      signedIn morePeople={false} unavailable={false} error={false}
      onBack={() => setDetail(null)} onRetry={() => {}} onOfficial={() => {}} onPerson={() => {}} onAccount={() => {}} onMorePeople={() => {}}
      renderMap={visible => <View testID="map-section" style={{ height: 240, backgroundColor: colors.surfaceSubtle, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
        <Text testID="map-mount-state" style={{ color: colors.text }}>{visible ? "Mapa visible · muestra" : "Mapa aplazado"}</Text>
      </View>}
    />
    <View style={{ padding: 16, borderTopWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }}>
      <Pressable accessibilityRole="button" style={{ minHeight: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.onPrimary, fontWeight: "700", fontSize: 16 }}>{t("events.join")}</Text>
      </Pressable>
    </View>
  </View>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingVertical: 24,
          maxWidth: 520,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <View
          style={{
            padding: 14,
            marginHorizontal: 16,
            borderRadius: 16,
            backgroundColor: colors.warningSoft,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {t("events.preview")}
          </Text>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              lineHeight: 18,
              marginTop: 5,
            }}
          >
            {t("events.previewBody")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setCatalog((value) => !value)}
          style={{ marginHorizontal: 18, paddingVertical: 12 }}
        >
          <Text style={{ color: colors.primary, fontWeight: "700" }}>
            {t(catalog ? "events.previewExamples" : "events.previewAllCovers", {
              count: allCovers.length,
            })}
          </Text>
        </Pressable>
        {events.map((event, index) => (
          <EventCard
            key={event.id}
            event={event}
            variant="editorial"
            social={{
              count: index === 0 ? 0 : index + 2,
              joined: false,
              people: index === 0 ? [] : [
                {
                  user_id: "synthetic-ana",
                  nombre: "Ana",
                  avatar_url: null,
                  joined_at: event.last_seen_at,
                },
                {
                  user_id: "synthetic-leo",
                  nombre: "Leo",
                  avatar_url: null,
                  joined_at: event.last_seen_at,
                },
              ],
            }}
            preview
            onOpen={() => setDetail(event)}
            onJoin={() => {}}
          />
        ))}
      </ScrollView>
    </View>
  );
}
function Preview() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Design />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
registerRootComponent(Preview);
