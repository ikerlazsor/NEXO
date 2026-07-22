/* 
Sin sesión → login (o verify-email si hay email pendiente)
Sesión sin email verificado → verify-email
Sesión + onboarding incompleto → onboarding
Sesión + onboarding hecho → (tabs)
 */

import 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AndroidSwipeBack } from '../components/AndroidSwipeBack';
import { NexoAlertHost } from '../components/NexoAlertHost';
import {
  getPendingVerifyEmail,
  isEmailVerified,
  setPendingVerifyEmail,
} from '../lib/emailVerification';
import { fetchOnboardingStatus } from '../lib/onboarding';
import { I18nProvider } from '../lib/i18n';
import { isPasswordRecoveryPending, setPasswordRecoveryPending } from '../lib/passwordRecovery';
import { fetchAccountAccess } from '../lib/roles';
import { supabase } from '../lib/supabase';

void SplashScreen.preventAutoHideAsync().catch(() => {});

/** En RNS: `end` = límite derecho de la zona (desde x=0). ~42% ancho: fácil volver sin pelear el scroll. */
const BACK_GESTURE_END = Math.round(Dimensions.get('window').width * 0.48);

export const unstable_settings = {
  anchor: '(tabs)',
};

function metaOnboardingDone(user: Session['user'] | null | undefined): boolean {
  const meta = user?.user_metadata;
  return meta?.registro_completado === true || meta?.onboarding_completed === true;
}

function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [banned, setBanned] = useState(false);
  const [ready, setReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const sync = async (s: Session | null, opts?: { hideSplash?: boolean }) => {
      if (!mounted) return;
      setSession(s);

      if (!s) {
        setOnboardingDone(null);
        setBanned(false);
        if (opts?.hideSplash) {
          setReady(true);
          await SplashScreen.hideAsync().catch(() => {});
        }
        return;
      }

      // Sin email verificado: no mirar onboarding todavía
      if (!isEmailVerified(s.user)) {
        setOnboardingDone(null);
        setBanned(false);
        if (s.user.email) {
          void setPendingVerifyEmail(s.user.email);
        }
        if (opts?.hideSplash) {
          setReady(true);
          await SplashScreen.hideAsync().catch(() => {});
        }
        return;
      }

      const access = await fetchAccountAccess(s.user.id);
      if (!mounted) return;
      if (access.banned) {
        setBanned(true);
        setOnboardingDone(true);
        if (opts?.hideSplash) {
          setReady(true);
          await SplashScreen.hideAsync().catch(() => {});
        }
        return;
      }
      setBanned(false);

      // Metadata primero: login → feed sin pantalla intermedia
      if (metaOnboardingDone(s.user)) {
        setOnboardingDone(true);
        if (opts?.hideSplash) {
          setReady(true);
          await SplashScreen.hideAsync().catch(() => {});
        }
        // Confirmar en background (no bloquea UI)
        void fetchOnboardingStatus(s.user.id).then((dbDone) => {
          if (mounted && !dbDone && !metaOnboardingDone(s.user)) {
            setOnboardingDone(false);
          }
        });
        return;
      }

      const dbDone = await fetchOnboardingStatus(s.user.id);
      if (!mounted) return;
      const done = dbDone || metaOnboardingDone(s.user);
      setOnboardingDone(done);
      // Cache en metadata para próximos logins sin esperar a la DB
      if (dbDone && !metaOnboardingDone(s.user)) {
        void supabase.auth.updateUser({
          data: { registro_completado: true, onboarding_completed: true },
        });
      }
      if (opts?.hideSplash) {
        setReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    };

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      await sync(s, { hideSplash: true });
      if (mounted) {
        setReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        void (async () => {
          await setPasswordRecoveryPending(true);
          router.replace('/reset-password');
        })();
      }
      void sync(s);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootSegment = segments[0];
  const inLogin = rootSegment === 'login';
  const inOnboarding = rootSegment === 'onboarding';
  const inBanned = rootSegment === 'banned';
  const inResetPassword = rootSegment === 'reset-password';
  const inVerifyEmail = rootSegment === 'verify-email';

  useEffect(() => {
    if (!ready) return;
    if (session && isEmailVerified(session.user) && onboardingDone === null && !inResetPassword) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const recovery = await isPasswordRecoveryPending();
      if (cancelled) return;

      if (recovery) {
        if (!inResetPassword) {
          router.replace('/reset-password');
        }
        return;
      }

      // Sin sesión: verificar email pendiente o login
      if (!session) {
        const pendingEmail = await getPendingVerifyEmail();
        if (cancelled) return;
        if (pendingEmail) {
          if (!inVerifyEmail && !inLogin) {
            router.replace('/verify-email');
          }
          return;
        }
        if (!inLogin && !inResetPassword) {
          router.replace('/login');
        }
        return;
      }

      if (inResetPassword) return;

      if (banned && !inBanned) {
        router.replace('/banned');
        return;
      }

      if (banned && inBanned) return;

      if (!isEmailVerified(session.user)) {
        if (!inVerifyEmail) {
          if (session.user.email) await setPendingVerifyEmail(session.user.email);
          router.replace('/verify-email');
        }
        return;
      }

      if (onboardingDone === false && !inOnboarding) {
        router.replace('/onboarding');
        return;
      }

      if (onboardingDone === true && (inLogin || inOnboarding || inBanned || inVerifyEmail)) {
        router.replace('/(tabs)');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session,
    onboardingDone,
    banned,
    ready,
    rootSegment,
    inLogin,
    inOnboarding,
    inBanned,
    inResetPassword,
    inVerifyEmail,
    router,
  ]);

  // Mantener splash nativo hasta ready; sin segunda pantalla azul
  if (!ready) return null;

  return children;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <I18nProvider>
      <GestureHandlerRootView style={styles.root}>
        <NexoAlertHost>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AuthGate>
              <Stack
                screenOptions={{
                  headerShown: false,
                  freezeOnBlur: true,
                  animation: 'slide_from_right',
                  gestureEnabled: true,
                  fullScreenGestureEnabled: true,
                  animationMatchesGesture: true,
                  // start/end/top/bottom = bounds. end = ancho de la zona desde la izquierda.
                  gestureResponseDistance: { end: BACK_GESTURE_END },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ animation: 'none', gestureEnabled: false }} />
                <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'none' }} />
                <Stack.Screen name="verify-email" options={{ gestureEnabled: false, animation: 'fade' }} />
                <Stack.Screen name="reset-password" options={{ gestureEnabled: false, animation: 'fade' }} />
                <Stack.Screen
                  name="modal"
                  options={{ presentation: 'modal', animation: 'fade_from_bottom' }}
                />
              </Stack>
              <AndroidSwipeBack />
            </AuthGate>
            <StatusBar style="dark" />
          </ThemeProvider>
        </NexoAlertHost>
      </GestureHandlerRootView>
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
