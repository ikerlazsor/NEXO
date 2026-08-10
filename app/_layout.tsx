/* 
Sin sesión → login (o verify-email si hay email pendiente)
Sesión sin email verificado → verify-email
Sesión + onboarding incompleto → onboarding
Sesión + onboarding hecho → (tabs)
 */

import 'react-native-gesture-handler';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { Session } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { Asset } from 'expo-asset';
import { AndroidSwipeBack } from '../components/AndroidSwipeBack';
import { NexoAlertHost } from '../components/NexoAlertHost';
import { OfflineBanner } from '../components/OfflineBanner';
import { PushBootstrap } from '../components/PushBootstrap';
import { scheduleCoverPrefetch } from '../lib/prefetchCovers';
import { hydrateFeedFromDisk, hydrateChatsFromDisk, hydrateMyPlansFromDisk } from '../lib/prefetchHome';
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

const sentryDsn =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    enabled: !__DEV__,
    tracesSampleRate: 0.15,
  });
}

void SplashScreen.preventAutoHideAsync().catch(() => {});
// Precarga logo UI para login/registro (aparece al instante)
void Asset.fromModule(require('../assets/images/nexo-logo-ui.png')).downloadAsync().catch(() => {});
// Arranque: portadas + feed en disco (si hay) mientras AuthGate decide.
scheduleCoverPrefetch();
void hydrateFeedFromDisk();
void hydrateChatsFromDisk();
void hydrateMyPlansFromDisk();

/** iOS only: thin left-edge native pop. Android uses system back (no overlay / no RN gesture). */
const BACK_GESTURE_END = 20;

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

  return (
    <>
      <PushBootstrap userId={session?.user?.id ?? null} />
      {children}
    </>
  );
}

function RootLayout() {
  return (
    <I18nProvider>
      <GestureHandlerRootView style={styles.root}>
        <NexoAlertHost>
          <ThemeProvider value={DefaultTheme}>
            <AuthGate>
              <Stack
                screenOptions={{
                  headerShown: false,
                  freezeOnBlur: true,
                  animation: 'slide_from_right',
                  animationDuration: 280,
                  gestureEnabled: Platform.OS === 'ios',
                  fullScreenGestureEnabled: false,
                  animationMatchesGesture: Platform.OS === 'ios',
                  contentStyle: { backgroundColor: '#F2F7FF' },
                  ...(Platform.OS === 'ios'
                    ? { gestureResponseDistance: { end: BACK_GESTURE_END } }
                    : {}),
                }}
              >
                <Stack.Screen
                  name="(tabs)"
                  options={{ animation: 'none', gestureEnabled: false, freezeOnBlur: false }}
                />
                <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'none' }} />
                <Stack.Screen name="verify-email" options={{ gestureEnabled: false, animation: 'fade' }} />
                <Stack.Screen name="reset-password" options={{ gestureEnabled: false, animation: 'fade' }} />
                <Stack.Screen name="login" options={{ animation: 'fade', gestureEnabled: false }} />
                <Stack.Screen
                  name="create-plan"
                  options={{
                    presentation: 'modal',
                    animation: 'slide_from_bottom',
                    animationDuration: 320,
                    gestureEnabled: Platform.OS === 'ios',
                    fullScreenGestureEnabled: false,
                    freezeOnBlur: false,
                    contentStyle: { backgroundColor: '#FFF' },
                  }}
                />
                <Stack.Screen
                  name="rate-plan"
                  options={{
                    presentation: 'modal',
                    animation: 'slide_from_bottom',
                    animationDuration: 300,
                    gestureEnabled: Platform.OS === 'ios',
                    fullScreenGestureEnabled: false,
                  }}
                />
                <Stack.Screen
                  name="profile"
                  options={{ animation: 'fade_from_bottom', animationDuration: 260 }}
                />
                <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="analytics" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="community-norms" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="friends" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="saved-plans" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="plan-history" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="user-profile/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="plan/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen
                  name="direct-chat/[id]"
                  options={{ animation: 'slide_from_right', animationDuration: 260 }}
                />
                <Stack.Screen
                  name="modal"
                  options={{ presentation: 'modal', animation: 'fade_from_bottom' }}
                />
              </Stack>
              <AndroidSwipeBack />
              <OfflineBanner />
            </AuthGate>
            <StatusBar style="dark" />
          </ThemeProvider>
        </NexoAlertHost>
      </GestureHandlerRootView>
    </I18nProvider>
  );
}

export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  root: { flex: 1 },
});
