/* 
Sin sesión → login (o verify-email si hay email pendiente)
Sesión sin email verificado → verify-email
Sesión + onboarding incompleto → onboarding
Sesión + onboarding hecho → (tabs)
 */

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';

import { Asset } from 'expo-asset';
import { AndroidSwipeBack } from '../components/AndroidSwipeBack';
import { NexoAlertHost } from '../components/NexoAlertHost';
import { OfflineBanner } from '../components/OfflineBanner';
import { PushBootstrap } from '../components/PushBootstrap';
import { NexoButton } from '../components/ui/NexoButton';
import { NexoLoadingState } from '../components/ui/NexoState';
import { scheduleCoverPrefetch } from '../lib/prefetchCovers';
import { hydrateFeedFromDisk, hydrateChatsFromDisk, hydrateMyPlansFromDisk } from '../lib/prefetchHome';
import {
  getPendingVerifyEmail,
  isEmailVerified,
  setPendingVerifyEmail,
} from '../lib/emailVerification';
import { fetchOnboardingStatus } from '../lib/onboarding';
import { reconcileLocalUserData } from '../lib/localDataPrivacy';
import { I18nProvider } from '../lib/i18n';
import { getIsOnline } from '../lib/network';
import { isPasswordRecoveryPending, setPasswordRecoveryPending } from '../lib/passwordRecovery';
import { fetchAccountAccess } from '../lib/roles';
import {
  STARTUP_TIMEOUT_MS,
  StartupCoordinator,
  shouldRunStartupForAuthEvent,
  throwIfAborted,
  type StartupFailure,
} from '../lib/startupControl';
import { supabase } from '../lib/supabase';
import { navigationTheme, theme } from '../theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});
// Precarga logo UI para login/registro (aparece al instante)
void Asset.fromModule(require('../assets/images/nexo-logo-ui.png')).downloadAsync().catch(() => {});
// Solo se precargan recursos públicos hasta conocer la identidad de la sesión.
scheduleCoverPrefetch();

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
  const [startupPhase, setStartupPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [startupFailure, setStartupFailure] = useState<StartupFailure | null>(null);
  const coordinatorRef = useRef(new StartupCoordinator());
  const latestSessionRef = useRef<Session | null>(null);
  const sessionKnownRef = useRef(false);
  const retryRef = useRef<() => void>(() => {});
  const splashReleasedRef = useRef(false);
  const startupReadyRef = useRef(false);
  const segments = useSegments();
  const router = useRouter();
  const ready = startupPhase === 'ready';

  useEffect(() => {
    let mounted = true;
    const coordinator = coordinatorRef.current;

    const releaseSplash = async () => {
      if (splashReleasedRef.current) return;
      splashReleasedRef.current = true;
      await SplashScreen.hideAsync().catch(() => {});
    };

    type StartupSnapshot = {
      session: Session | null;
      onboardingDone: boolean | null;
      banned: boolean;
    };

    const runStartup = async (providedSession?: Session | null) => {
      if (!mounted) return;
      startupReadyRef.current = false;
      setStartupFailure(null);
      setStartupPhase('loading');

      const result = await coordinator.run<StartupSnapshot>(
        async (signal) => {
          let nextSession = providedSession;
          if (providedSession === undefined) {
            const { data, error } = await supabase.auth.getSession();
            if (error) throw error;
            nextSession = data.session;
          }
          throwIfAborted(signal);

          const nextUserId = nextSession?.user.id ?? null;
          await reconcileLocalUserData(nextUserId);
          throwIfAborted(signal);

          if (nextUserId) {
            await Promise.all([
              hydrateFeedFromDisk(nextUserId),
              hydrateChatsFromDisk(nextUserId),
              hydrateMyPlansFromDisk(nextUserId),
            ]);
            throwIfAborted(signal);
          }

          if (!nextSession) {
            return { session: null, onboardingDone: null, banned: false };
          }

          if (!isEmailVerified(nextSession.user)) {
            if (nextSession.user.email) {
              await setPendingVerifyEmail(nextSession.user.email);
              throwIfAborted(signal);
            }
            return { session: nextSession, onboardingDone: null, banned: false };
          }

          const access = await fetchAccountAccess(nextSession.user.id, {
            signal,
            throwOnError: true,
          });
          throwIfAborted(signal);
          if (!access.verified) throw new Error('Account access could not be verified');
          if (access.banned) {
            return { session: nextSession, onboardingDone: true, banned: true };
          }

          if (metaOnboardingDone(nextSession.user)) {
            return { session: nextSession, onboardingDone: true, banned: false };
          }

          const dbDone = await fetchOnboardingStatus(nextSession.user.id, {
            signal,
            throwOnError: true,
          });
          throwIfAborted(signal);
          if (dbDone) {
            void supabase.auth.updateUser({
              data: { registro_completado: true, onboarding_completed: true },
            });
          }
          return { session: nextSession, onboardingDone: dbDone, banned: false };
        },
        { timeoutMs: STARTUP_TIMEOUT_MS, isOnline: getIsOnline },
      );

      if (!mounted || result.status === 'stale') return;
      await releaseSplash();
      if (!mounted) return;

      if (result.status === 'failure') {
        startupReadyRef.current = false;
        setStartupFailure(result.failure);
        setStartupPhase('error');
        return;
      }

      sessionKnownRef.current = true;
      latestSessionRef.current = result.value.session;
      setSession(result.value.session);
      setOnboardingDone(result.value.onboardingDone);
      setBanned(result.value.banned);
      startupReadyRef.current = true;
      setStartupPhase('ready');
    };

    retryRef.current = () => {
      void runStartup(sessionKnownRef.current ? latestSessionRef.current : undefined);
    };

    void runStartup();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, s) => {
      const previousUserId = latestSessionRef.current?.user.id ?? null;
      const nextUserId = s?.user.id ?? null;
      sessionKnownRef.current = true;
      latestSessionRef.current = s;
      if (event === 'PASSWORD_RECOVERY') {
        void (async () => {
          await setPasswordRecoveryPending(true);
          router.replace('/reset-password');
        })();
      }

      if (
        !shouldRunStartupForAuthEvent(
          event,
          previousUserId,
          nextUserId,
          startupReadyRef.current,
        )
      ) {
        setSession(s);
        if (metaOnboardingDone(s?.user)) setOnboardingDone(true);
        return;
      }
      void runStartup(s);
    });

    return () => {
      mounted = false;
      retryRef.current = () => {};
      coordinator.cancel();
      authListener.subscription.unsubscribe();
    };
  }, [router]);

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

  if (startupPhase === 'loading') {
    if (!splashReleasedRef.current) return null;
    return <NexoLoadingState label="Verificando tu cuenta…" />;
  }

  if (startupPhase === 'error') {
    const isOffline = startupFailure?.kind === 'offline';
    const isTimeout = startupFailure?.kind === 'timeout';
    return (
      <View style={styles.accessUnavailable}>
        <Text style={styles.accessUnavailableTitle}>
          {isOffline
            ? 'Sin conexión'
            : isTimeout
              ? 'La comprobación está tardando demasiado'
              : 'No se pudo iniciar NEXO'}
        </Text>
        <Text style={styles.accessUnavailableBody}>
          {isOffline
            ? 'Conéctate a Internet y vuelve a intentarlo. NEXO no abrirá datos de otra cuenta mientras no pueda verificar la sesión.'
            : isTimeout
              ? 'La verificación superó el tiempo máximo de espera. Puedes reintentarlo sin cerrar la aplicación.'
              : 'No se ha podido comprobar la sesión de forma segura. Inténtalo de nuevo.'}
        </Text>
        <NexoButton
          label="Reintentar"
          onPress={() => retryRef.current()}
          style={styles.accessRetryButton}
        />
      </View>
    );
  }

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
          <ThemeProvider value={navigationTheme}>
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
                  contentStyle: { backgroundColor: theme.colors.backgroundAlt },
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
                    contentStyle: { backgroundColor: theme.colors.surface },
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
                  options={{
                    animation: 'slide_from_bottom',
                    animationDuration: 320,
                    gestureEnabled: Platform.OS === 'ios',
                    fullScreenGestureEnabled: false,
                    freezeOnBlur: false,
                    contentStyle: { backgroundColor: theme.colors.surface },
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{ animation: 'slide_from_right', freezeOnBlur: false }}
                />
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

export default RootLayout;

const styles = StyleSheet.create({
  root: { flex: 1 },
  accessUnavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.backgroundAlt,
    paddingHorizontal: 28,
  },
  accessUnavailableTitle: {
    color: theme.colors.text,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  accessUnavailableBody: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 420,
    textAlign: 'center',
  },
  accessRetryButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 14,
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
});

