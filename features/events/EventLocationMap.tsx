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
    // Mismo bloque que la ubicación de un plan de Nexo: título con icono, lugar y mapa grande.
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="location" size={18} color={colors.primary} />
        <Text style={{ fontSize: 19, fontWeight: "800", color: colors.text }}>
          {t("planDetail.location")}
        </Text>
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: "500", marginBottom: 4 }}>
        {event.venue}
        {event.address ? ` · ${event.address}` : ""}
      </Text>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t("events.openMap")}
        style={{
          height: 280,
          borderRadius: 18,
          overflow: "hidden",
          backgroundColor: colors.primarySoft,
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
            <Ionicons name="map-outline" size={36} color={colors.primary} />
          </View>
        )}
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 12, alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(15,42,74,0.72)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}>
            <Ionicons name="expand" size={16} color="#FFF" />
            <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>{t("planDetail.expandMap")}</Text>
          </View>
        </View>
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
