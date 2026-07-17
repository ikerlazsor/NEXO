/* 
Sin sesión → login
Sesión + onboarding incompleto → onboarding
Sesión + onboarding hecho → (tabs)  (pantalla principal)
 */

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchOnboardingStatus } from '../lib/onboarding';
import { I18nProvider } from '../lib/i18n';
import { supabase } from '../lib/supabase';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const sync = async (s: Session | null) => {
      if (!mounted) return;
      setSession(s);
      if (!s) {
        setOnboardingDone(null);
        return;
      }
      const dbDone = await fetchOnboardingStatus(s.user.id);
      const metaDone =
        s.user.user_metadata?.registro_completado === true ||
        s.user.user_metadata?.onboarding_completed === true;
      setOnboardingDone(dbDone || metaDone);
    };

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      await sync(s);
      if (mounted) setReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, s) => {
      sync(s);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const rootSegment = segments[0];
  const inLogin = rootSegment === 'login';
  const inOnboarding = rootSegment === 'onboarding';

  useEffect(() => {
    if (!ready) return;
    if (session && onboardingDone === null) return;

    if (!session && !inLogin) {
      router.replace('/login');
      return;
    }

    if (session && onboardingDone === false && !inOnboarding) {
      router.replace('/onboarding');
      return;
    }

    if (session && onboardingDone === true && (inLogin || inOnboarding)) {
      router.replace('/(tabs)');
    }
  }, [session, onboardingDone, ready, rootSegment, inLogin, inOnboarding, router]);

  if (!ready || (session && onboardingDone === null)) {
    return null;
  }

  return children;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <I18nProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false, freezeOnBlur: true }}>
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
          </Stack>
        </AuthGate>
        <StatusBar style="dark" />
      </ThemeProvider>
    </I18nProvider>
  );
}
