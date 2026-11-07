import { registerRootComponent } from "expo";
import { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useT } from "../../lib/i18n";
import { useAppTheme } from "../../lib/appTheme";
import { EventCard, EventTabs } from "../../features/events/EventCards";
import {
  previewEvents,
  previewCoverCatalog,
} from "../../features/events/previewData";
import type { EventSection } from "../../features/events/types";
function Design() {
  const [section, setSection] = useState<EventSection>("agenda");
  const [catalog, setCatalog] = useState(false);
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
        <EventTabs value={section} onChange={setSection} />
        {section === "plans" && (
          <Text style={{ padding: 24, color: colors.textMuted }}>
            {t("events.viewPlans")} · {t("events.preview")}
          </Text>
        )}
        {section !== "plans" &&
          events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              variant={section === "agenda" ? "editorial" : "compact"}
              preview
              onOpen={() => {}}
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
