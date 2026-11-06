import { useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAppTheme } from "../lib/appTheme";
import { useT } from "../lib/i18n";
import {
  AgendaIntro,
  EventCard,
  EventTabs,
} from "../features/events/EventCards";
import { previewEvents } from "../features/events/previewData";
import type { EventSection } from "../features/events/types";
import { PlanCard } from "../components/PlanCard";
const noop = () => {};
export default function AgendaPreview() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const router = useRouter();
  const [section, setSection] = useState<EventSection>("agenda");
  const events = useMemo(previewEvents, []);
  const plan = useMemo(
    () => ({
      id: "synthetic-plan",
      titulo: "Un café y una buena conversación",
      categoria: "FOODIES",
      tipo_deporte: "cafe",
      fecha_evento: new Date(Date.now() + 2 * 86400000).toISOString(),
      creador_id: "synthetic-person",
      participantsList: [],
      joinedCount: 0,
      maximo_participantes: 6,
      nombre_ubicacion: "Madrid · ejemplo de diseño",
      imagen_url: null,
    }),
    [],
  );
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom"]}
    >
      <ScrollView
        contentContainerStyle={{
          paddingBottom: 36,
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
        }}
      >
        <Pressable
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={{ padding: 18 }}
        >
          <Text style={{ color: colors.primary }}>‹ {t("common.back")}</Text>
        </Pressable>
        <View
          style={{
            marginHorizontal: 18,
            padding: 14,
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
        <EventTabs value={section} onChange={setSection} />
        {section === "agenda" && <AgendaIntro />}
        {section !== "agenda" && (
          <View pointerEvents="none">
            <PlanCard
              item={plan}
              index={0}
              currentUserId={null}
              membership="none"
              isSaved={false}
              onJoin={noop}
              onLeave={noop}
              onDelete={noop}
              onEdit={noop}
              onToggleSave={noop}
              onOpenDetail={noop}
              router={{ push: noop }}
            />
          </View>
        )}
        {section !== "plans" &&
          events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              variant={section === "agenda" ? "editorial" : "compact"}
              onOpen={noop}
              onJoin={noop}
              preview
            />
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
