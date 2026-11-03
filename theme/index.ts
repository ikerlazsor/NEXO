import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import { Platform, type ViewStyle } from 'react-native';

const lightColors = {
  brand: '#4DA6FF',
  primary: '#2563EB',
  primaryPressed: '#1D4ED8',
  primarySoft: '#EFF6FF',
  primaryBorder: '#DBEAFE',
  text: '#0F2A4A',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  background: '#F8FAFC',
  backgroundAlt: '#F2F7FF',
  surface: '#FFFFFF',
  surfaceSubtle: '#F1F5F9',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  overlay: 'rgba(15,42,74,0.45)',
  danger: '#DC2626',
  dangerDark: '#991B1B',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
  success: '#22C55E',
  successStrong: '#059669',
  successSoft: '#ECFDF5',
  warning: '#F59E0B',
  warningSoft: '#FFFBEB',
  accent: '#7C3AED',
  accentSoft: '#F5F3FF',
  onPrimary: '#FFFFFF',
  tabBar: '#0F2A4A',
  onTabBar: '#FFFFFF',
  gradientTop: '#DCEBFF',
  gradientBottom: '#F2F7FF',
  bubbleMine: '#70B7FF',
  bubbleMineText: '#0F2A4A',
  mapPinBorder: '#FFFFFF',
  // Sin la unión, el tipo se fija en 'dark' y el tema oscuro no encaja.
  statusBar: 'dark' as 'dark' | 'light',
};

const darkColors: typeof lightColors = {
  brand: '#60A5FA',
  primary: '#3B82F6',
  primaryPressed: '#2563EB',
  primarySoft: '#1E3A5F',
  primaryBorder: '#1E40AF',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  background: '#0B1220',
  backgroundAlt: '#0F172A',
  surface: '#151E32',
  surfaceSubtle: '#1E293B',
  border: '#243044',
  borderStrong: '#334155',
  overlay: 'rgba(2,6,23,0.72)',
  danger: '#F87171',
  dangerDark: '#FCA5A5',
  dangerSoft: '#3F1D1D',
  dangerBorder: '#7F1D1D',
  success: '#34D399',
  successStrong: '#10B981',
  successSoft: '#052E22',
  warning: '#FBBF24',
  warningSoft: '#422006',
  accent: '#A78BFA',
  accentSoft: '#2E1065',
  onPrimary: '#FFFFFF',
  tabBar: '#1C2740',
  onTabBar: '#F8FAFC',
  gradientTop: '#0B1220',
  gradientBottom: '#0F172A',
  bubbleMine: '#1D4ED8',
  bubbleMineText: '#F8FAFC',
  mapPinBorder: '#151E32',
  statusBar: 'light',
};

export type ThemeColors = typeof lightColors;
export type ColorSchemeName = 'light' | 'dark';
export type ThemePreference = 'system' | 'light' | 'dark';

export const palettes = { light: lightColors, dark: darkColors } as const;

const cardShadow: ViewStyle =
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
    default: {},
  }) ?? {};

const floatingShadow: ViewStyle =
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 10 },
    default: {},
  }) ?? {};

export const theme = {
  colors: lightColors,
  spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 },
  radii: { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  typography: {
    caption: { fontSize: 12, lineHeight: 17, fontWeight: '600' as const },
    bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
    body: { fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
    title: { fontSize: 20, lineHeight: 27, fontWeight: '800' as const },
    headline: { fontSize: 26, lineHeight: 33, fontWeight: '800' as const },
  },
  shadows: { card: cardShadow, floating: floatingShadow },
  accessibility: { minimumTouchTarget: 48, maximumTextScale: 2 },
} as const;

export function navigationThemeFor(scheme: ColorSchemeName, colors: ThemeColors) {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.backgroundAlt,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
}

export const navigationTheme = navigationThemeFor('light', lightColors);
