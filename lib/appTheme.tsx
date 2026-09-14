import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    type ReactNode,
} from 'react';
import { Appearance, Platform, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import {
    navigationThemeFor,
    palettes,
    type ColorSchemeName,
    type ThemeColors,
    type ThemePreference,
} from '../theme';

type AppThemeValue = {
    preference: ThemePreference;
    scheme: ColorSchemeName;
    colors: ThemeColors;
    navigationTheme: ReturnType<typeof navigationThemeFor>;
    setPreference: (next: ThemePreference) => void;
};

const AppThemeContext = createContext<AppThemeValue | null>(null);

const LIGHT: ColorSchemeName = 'light';

export function AppThemeProvider({ children }: { children: ReactNode }) {
    const scheme = LIGHT;
    const colors = palettes.light;
    const navigationTheme = useMemo(() => navigationThemeFor(scheme, colors), [scheme, colors]);
    const setPreference = useCallback((_next: ThemePreference) => {}, []);

    useEffect(() => {
        Appearance.setColorScheme('light');
        void SystemUI.setBackgroundColorAsync(colors.backgroundAlt);
    }, [colors.backgroundAlt]);

    const value = useMemo<AppThemeValue>(
        () => ({ preference: 'light', scheme, colors, navigationTheme, setPreference }),
        [scheme, colors, navigationTheme, setPreference],
    );

    return (
        <AppThemeContext.Provider value={value}>
            <StatusBar style={colors.statusBar} />
            {children}
        </AppThemeContext.Provider>
    );
}

export function useAppTheme(): AppThemeValue {
    const ctx = useContext(AppThemeContext);
    if (!ctx) {
        return {
            preference: 'light',
            scheme: LIGHT,
            colors: palettes.light,
            navigationTheme: navigationThemeFor(LIGHT, palettes.light),
            setPreference: () => {},
        };
    }
    return ctx;
}

export function useThemedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
    factory: (colors: ThemeColors) => T,
): T {
    const { colors } = useAppTheme();
    return useMemo(() => factory(colors), [colors, factory]);
}

export function inputKeyboardAppearance(_scheme?: ColorSchemeName): 'light' | 'dark' {
    return 'light';
}

export const androidNavBarStyle = Platform.select({
    android: { navigationBarColor: 'transparent' as const },
    default: {},
});
