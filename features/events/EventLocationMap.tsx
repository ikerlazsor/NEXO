import {
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { NexoMapView } from "../../components/NexoMapView";
import { useAppTheme } from "../../lib/appTheme";
import { useT } from "../../lib/i18n";
import type { ExternalEvent } from "./types";
import { useEffect, useState } from "react";
import { getCategoryColor } from "../../lib/categories";
import { eventClassification } from "./covers";
export function EventLocationMap({ event, enabled }: { event: ExternalEvent; enabled: boolean }) {
  const [mounted, setMounted] = useState(false);
  // Keep an existing map through the outgoing animation; unmount with the route.
  useEffect(() => { if (enabled) setMounted(true); }, [enabled]);
  const { colors } = useAppTheme();
  const { t } = useT();
  const { latitude, longitude } = event;
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const open = () => {
    void Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    ).catch(() => {});
  };
  return (
    <View style={{ marginTop: 24, gap: 10 }}>
      <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>
        {t("events.location")}
      </Text>
      <Text style={{ color: colors.textMuted }}>
        {event.venue}
        {event.address ? ` · ${event.address}` : ""}
      </Text>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t("events.openMap")}
        style={{
          height: 190,
          borderRadius: 20,
          overflow: "hidden",
          backgroundColor: colors.surfaceSubtle,
        }}
      >
        {mounted ? (
          <NexoMapView
            style={{ flex: 1 }}
            initialRegion={{
              latitude,
              longitude,
              latitudeDelta: 0.008,
              longitudeDelta: 0.008,
            }}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            liteMode={Platform.OS === "android"}
            pointerEvents="none"
          >
            <Marker coordinate={{ latitude, longitude }} pinColor={getCategoryColor(eventClassification(event).category)} />
          </NexoMapView>
        ) : (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="map-outline" size={32} color={colors.primary} />
          </View>
        )}
      </Pressable>
      <Pressable onPress={open} accessibilityRole="link">
        <Text style={{ color: colors.primary, fontWeight: "700" }}>
          {t("events.openMap")}
        </Text>
      </Pressable>
      {event.location_source === "openstreetmap" && (
        <Pressable
          onPress={() =>
            void Linking.openURL("https://www.openstreetmap.org/copyright")
          }
          accessibilityRole="link"
        >
          <Text style={{ fontSize: 11, color: colors.textMuted }}>
            © OpenStreetMap contributors
          </Text>
        </Pressable>
      )}
    </View>
  );
}
