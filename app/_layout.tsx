/* 
Sin sesión → feed invitado (login/verify-email si hay registro pendiente)
Sesión sin email verificado → verify-email
Sesión + onboarding incompleto → onboarding
Sesión + onboarding hecho → (tabs)
 */

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';
import { hideNativeSplashOnce } from '../lib/nativeSplash';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';

import { Asset } from 'expo-asset';
import { AndroidSwipeBack } from '../components/AndroidSwipeBack';
import { NexoAlertHost } from '../components/NexoAlertHost';
import { InAppToastHost } from '../components/InAppToastHost';
import { OfflineBanner } from '../components/OfflineBanner';
import { PushBootstrap } from '../components/PushBootstrap';
import { NexoButton } from '../components/ui/NexoButton';
import { NexoLoadingState } from '../components/ui/NexoState';
import { scheduleCoverPrefetch } from '../lib/prefetchCovers';
import { hydrateFeedFromDisk, hydrateChatsFromDisk, hydrateMyPlansFromDisk, scheduleOnboardingPrefetch } from '../lib/prefetchHome';
import { FEED_CACHE_KEY } from '../lib/feedCache';
import { hydrateUserCoordsFromDisk } from '../lib/location';
import { getIsOnline, subscribeNetwork } from '../lib/network';
import { flushOfflineActions } from '../lib/offlineActions';
import { cacheGetStale } from '../lib/ttlCache';
import {
  getPendingVerifyEmail,
  isEmailVerified,
  setPendingVerifyEmail,
} from '../lib/emailVerification';
import { fetchOnboardingStatus } from '../lib/onboarding';
import { reconcileLocalUserData } from '../lib/localDataPrivacy';
import { AuthPromptHost } from '../components/AuthPromptHost';
import { LaunchRevealHost, willShowLaunchSplashOverlay } from '../components/LaunchRevealHost';
import { LAUNCH_SPLASH_BG } from '../components/LaunchMaskReveal';
import { AuthSessionProvider } from '../lib/authSession';
import { takePendingAuthRoute } from '../lib/authIntent';
import { I18nProvider } from '../lib/i18n';
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
import { ensureStartupAppUpdateCheck, startAppUpdateListener } from '../lib/appUpdates';
import { AppThemeProvider, useAppTheme } from '../lib/appTheme';
import { theme } from '../theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});
// Sin fade nativo: el handoff lo hace el overlay JS (evita el “tic” del logo).
try {
  SplashScreen.setOptions({ fade: false, duration: 0 });
} catch {
  /* Expo Go / web */
}
// Precarga logo UI para login/registro (aparece al instante)
void Asset.fromModule(require('../assets/images/nexo-logo-ui.png')).downloadAsync().catch(() => {});
void Asset.fromModule(require('../assets/images/nexo-splash-logo.png')).downloadAsync().catch(() => {});
// Solo se precargan recursos públicos hasta conocer la identidad de la sesión.
scheduleCoverPrefetch();

/** iOS only: thin left-edge native pop. Android uses system back (no overlay / no RN gesture). */
const BACK_GESTURE_END = 20;

const GUEST_ROOTS = new Set([
  '(tabs)',
  'plan',
  'settings',
  'privacy',
  'terms',
  'community-norms',
  'help-center',
  'login',
  'verify-email',
  'reset-password',
  'my-plans',
]);

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
  const { colors } = useAppTheme();
  const ready = startupPhase === 'ready';

  useEffect(() => {
    let mounted = true;
    const coordinator = coordinatorRef.current;

    const releaseSplash = async () => {
      if (splashReleasedRef.current) return;
      splashReleasedRef.current = true;
    };

    type StartupSnapshot = {
      session: Session | null;
      onboardingDone: boolean | null;
      banned: boolean;
      deferNetwork: boolean;
    };

    const verifyAccountInBackground = async (s: Session) => {
      if (!getIsOnline()) return;
      try {
        const access = await fetchAccountAccess(s.user.id);
        if (!mounted) return;
        if (access.banned) {
          setBanned(true);
          return;
        }
        if (access.verified && !metaOnboardingDone(s.user)) {
          const dbDone = await fetchOnboardingStatus(s.user.id);
          if (!mounted) return;
          setOnboardingDone(dbDone);
          if (dbDone) {
            void supabase.auth.updateUser({
              data: { registro_completado: true, onboarding_completed: true },
            });
          }
        }
      } catch {
        /* ya hay UI; el ban/onboarding se comprobará al volver online */
      }
    };

    const runStartup = async (providedSession?: Session | null) => {
      if (!mounted) return;
      startupReadyRef.current = false;
      setStartupFailure(null);
      setStartupPhase('loading');

      // OTA en paralelo: no bloquear splash ni forzar reload aquí.
      void ensureStartupAppUpdateCheck();

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

          await hydrateUserCoordsFromDisk();
          throwIfAborted(signal);

          await Promise.all([
            hydrateFeedFromDisk(nextUserId),
            nextUserId ? hydrateChatsFromDisk(nextUserId) : Promise.resolve(),
            nextUserId ? hydrateMyPlansFromDisk(nextUserId) : Promise.resolve(),
          ]);
          throwIfAborted(signal);

          if (!nextSession) {
            return { session: null, onboardingDone: null, banned: false, deferNetwork: false };
          }

          if (!isEmailVerified(nextSession.user)) {
            if (nextSession.user.email) {
              await setPendingVerifyEmail(nextSession.user.email);
              throwIfAborted(signal);
            }
            return { session: nextSession, onboardingDone: null, banned: false, deferNetwork: false };
          }

          const hadCache = cacheGetStale(FEED_CACHE_KEY) != null;
          const metaDone = metaOnboardingDone(nextSession.user);
          // Instagram-style: pintar ya (disco/caché) y validar ban/onboarding en background.
          return {
            session: nextSession,
            onboardingDone: metaDone || hadCache,
            banned: false,
            deferNetwork: true,
          };
        },
        { timeoutMs: STARTUP_TIMEOUT_MS, isOnline: getIsOnline },
      );

      if (!mounted || result.status === 'stale') return;

      if (result.status === 'failure') {
        await releaseSplash();
        if (!mounted) return;
        const offlineLike =
          result.failure.kind === 'offline' || result.failure.kind === 'timeout';
        if (offlineLike) {
          const localSession =
            latestSessionRef.current
            ?? (await supabase.auth.getSession()).data.session
            ?? null;
          if (localSession && isEmailVerified(localSession.user)) {
            await hydrateUserCoordsFromDisk();
            await Promise.all([
              hydrateFeedFromDisk(localSession.user.id),
              hydrateChatsFromDisk(localSession.user.id),
              hydrateMyPlansFromDisk(localSession.user.id),
            ]);
            const hadCache = cacheGetStale(FEED_CACHE_KEY) != null;
            if (metaOnboardingDone(localSession.user) || hadCache) {
              sessionKnownRef.current = true;
              latestSessionRef.current = localSession;
              setSession(localSession);
              setOnboardingDone(true);
              setBanned(false);
              startupReadyRef.current = true;
              setStartupPhase('ready');
              return;
            }
          }
        }
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
      requestAnimationFrame(() => {
        void releaseSplash();
      });
      if (result.value.session?.user?.id) {
        void import('../lib/viewerAffinityCache').then(({ ensureViewerAffinityPerson }) => {
          void ensureViewerAffinityPerson(result.value!.session!.user.id);
        });
      }
      if (result.value.deferNetwork && result.value.session) {
        void verifyAccountInBackground(result.value.session);
      }
      if (!result.value.session) scheduleOnboardingPrefetch();
    };

    retryRef.current = () => {
      void runStartup(sessionKnownRef.current ? latestSessionRef.current : undefined);
    };

    void runStartup();

    const unsubNet = subscribeNetwork((online) => {
      if (!online) return;
      void flushOfflineActions();
      const s = latestSessionRef.current;
      if (!s?.user?.id || !startupReadyRef.current) return;
      void fetchAccountAccess(s.user.id).then((access) => {
        if (!mounted || !access.verified) return;
        if (access.banned) setBanned(true);
      });
    });

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
      unsubNet();
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

      // Sin sesión: registro pendiente, o browse de invitado
      if (!session) {
        const pendingEmail = await getPendingVerifyEmail();
        if (cancelled) return;
        if (pendingEmail) {
          if (!inVerifyEmail && !inLogin) {
            router.replace('/verify-email');
          }
          return;
        }
        if (rootSegment && !GUEST_ROOTS.has(rootSegment)) {
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
        const next = await takePendingAuthRoute();
        if (cancelled) return;
        router.replace(next);
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

  useEffect(() => {
    if (startupPhase === 'error') {
      void hideNativeSplashOnce();
    }
  }, [startupPhase]);

  useEffect(() => {
    if (!ready) return;
    const onMainFeed = rootSegment === '(tabs)' || rootSegment === undefined;
    const blocked = inLogin || inOnboarding || inBanned || inVerifyEmail || inResetPassword;
    if (!willShowLaunchSplashOverlay(blocked, onMainFeed)) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void hideNativeSplashOnce();
        });
      });
    }
  }, [ready, rootSegment, inLogin, inOnboarding, inBanned, inVerifyEmail, inResetPassword]);

  const gateBlocked =
    inLogin || inOnboarding || inBanned || inVerifyEmail || inResetPassword;
  const booting = startupPhase === 'loading';

  let body: ReactNode = null;
  if (startupPhase === 'error') {
    const isOffline = startupFailure?.kind === 'offline';
    const isTimeout = startupFailure?.kind === 'timeout';
    body = (
      <View style={[styles.accessUnavailable, { backgroundColor: colors.backgroundAlt }]}>
        <Text style={[styles.accessUnavailableTitle, { color: colors.text }]}>
          {isOffline
            ? 'Sin conexión'
            : isTimeout
              ? 'La comprobación está tardando demasiado'
              : 'No se pudo iniciar Nexo!'}
        </Text>
        <Text style={[styles.accessUnavailableBody, { color: colors.textMuted }]}>
          {isOffline
            ? 'Conéctate a Internet y vuelve a intentarlo. Si ya usaste Nexo!, al reintentar se abrirá lo último guardado.'
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
  } else if (booting) {
    body = splashReleasedRef.current ? (
      <NexoLoadingState label="Verificando tu cuenta…" />
    ) : (
      <View style={{ flex: 1, backgroundColor: LAUNCH_SPLASH_BG }} />
    );
  } else {
    body = (
      <AuthSessionProvider session={session}>
        <PushBootstrap
          userId={session?.user?.id ?? null}
          ready={Boolean(session && onboardingDone === true && !banned)}
        />
        {children}
        <AuthPromptHost />
      </AuthSessionProvider>
    );
  }

  return (
    <LaunchRevealHost
      booting={booting}
      ready={startupPhase === 'ready' || startupPhase === 'error'}
      blocked={startupPhase === 'error' ? true : gateBlocked}
    >
      {body}
    </LaunchRevealHost>
  );
}

function ThemedNavigation({ children }: { children: ReactNode }) {
  const { navigationTheme: navTheme, colors } = useAppTheme();
  return (
    <ThemeProvider value={navTheme}>
      <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.backgroundAlt }]}>
        {children}
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}

function RootLayout() {
  useEffect(() => startAppUpdateListener(), []);

  return (
    <I18nProvider>
      <AppThemeProvider>
        <NexoAlertHost>
          <InAppToastHost>
          <ThemedNavigation>
            <AuthGate>
              <RootStack />
              <AndroidSwipeBack />
              <OfflineBanner />
            </AuthGate>
          </ThemedNavigation>
          </InAppToastHost>
        </NexoAlertHost>
      </AppThemeProvider>
    </I18nProvider>
  );
}
function RootStack() {
  const { colors } = useAppTheme();
  return (
              <Stack
                screenOptions={{
                  headerShown: false,
                  freezeOnBlur: true,
                  animation: 'slide_from_right',
                  animationDuration: 280,
                  gestureEnabled: Platform.OS === 'ios',
                  fullScreenGestureEnabled: false,
                  animationMatchesGesture: Platform.OS === 'ios',
                  contentStyle: { backgroundColor: colors.backgroundAlt },
                  ...(Platform.OS === 'ios'
                    ? { gestureResponseDistance: { end: BACK_GESTURE_END } }
                    : {}),
                }}
              >
                <Stack.Screen
                  name="(tabs)"
                  options={{ animation: 'none', gestureEnabled: false, freezeOnBlur: false }}
                />
                <Stack.Screen name="my-plans" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="search-profiles" options={{ animation: 'slide_from_right' }} />
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
                    contentStyle: { backgroundColor: colors.surface },
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
                    animationDuration: 380,
                    gestureEnabled: Platform.OS === 'ios',
                    fullScreenGestureEnabled: false,
                    freezeOnBlur: false,
                    contentStyle: { backgroundColor: colors.surface },
                  }}
                />
                <Stack.Screen
                  name="edit-profile"
                  options={{ animation: 'slide_from_right', freezeOnBlur: false }}
                />
                <Stack.Screen
                  name="settings"
                  options={{ animation: 'slide_from_right', freezeOnBlur: false }}
                />
                <Stack.Screen name="organizer-apply" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="organizer-members" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="organizer-insights" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="admin/organizers" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="admin/organizer/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="analytics" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="community-norms" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="friends" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="saved-plans" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="plan-history" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="user-profile/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="plan/[id]" options={{ animation: 'slide_from_right', freezeOnBlur: false }} />
                <Stack.Screen
                  name="direct-chat/[id]"
                  options={{ animation: 'slide_from_right', animationDuration: 260 }}
                />
                <Stack.Screen
                  name="modal"
                  options={{ presentation: 'modal', animation: 'fade_from_bottom' }}
                />
              </Stack>
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

