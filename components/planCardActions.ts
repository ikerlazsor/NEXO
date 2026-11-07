import type { TextStyle, ViewStyle } from "react-native";

export const JOINED_PLAN_COLORS = {
  text: "#10B981",
  background: "#D1FAE5",
  border: "#34D399",
} as const;

/** Shared visual language for social-plan and external-event actions. */
export function planCardActionStyles(isDark: boolean) {
  const geometry: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    minWidth: 118,
  };
  return {
    button: {
      ...geometry,
      backgroundColor: "#1D4ED8",
      shadowColor: "#1E3A8A",
      shadowOpacity: isDark ? 0.35 : 0.28,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    } as ViewStyle,
    label: { color: "#FFF", fontWeight: "800", fontSize: 15 } as TextStyle,
    joined: {
      ...geometry,
      backgroundColor: JOINED_PLAN_COLORS.background,
      borderWidth: 2,
      borderColor: JOINED_PLAN_COLORS.border,
    } as ViewStyle,
    joinedLabel: {
      color: JOINED_PLAN_COLORS.text,
      fontWeight: "800",
      fontSize: 15,
    } as TextStyle,
  };
}
