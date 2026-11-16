import AsyncStorage from '@react-native-async-storage/async-storage';
import { discardChatOutbox } from './chatOutbox';
import { discardOfflineActions } from './offlineActions';
import { resetNotificationCategoryPrefsCache } from './notificationPrefs';
import { resetPasswordRecoveryMemory } from './passwordRecovery';
import { clearAllScreenState } from './screenState';
import { cacheClearAll } from './ttlCache';

const ACTIVE_USER_KEY = '@nexo_active_user_v1';

const PERSONAL_EXACT_KEYS = new Set([
  ACTIVE_USER_KEY,
  '@nexo_pending_verify_email',
  '@nexo_pending_signup',
  '@nexo_push_enabled',
  '@nexo_first_run_v1',
  '@nexo_norms_seen_v1',
  '@nexo_password_recovery',
  '@nexo_chat_outbox_v1',
  '@nexo_offline_actions_v1',
  '@nexo_muted_plan_chats_v1',
  '@nexo_analytics_queue_v1',
  '@nexo_notif_prefs_v1',
  '@nexo_pending_auth_intent',
]);

const PERSONAL_PREFIXES = [
  '@nexo_disk:',
  '@nexo_rating_started:',
  '@nexo_direct_open:',
  '@nexo_plan_chat_hide:',
  '@nexo_myplan_hide:',
];

/** Memoria de “ya atendido” en este dispositivo: sobrevive a logout de la misma cuenta. */
const SESSION_MEMORY_PREFIXES = [
  '@nexo_chat_read:',
  '@nexo_chat_read_index:',
  '@nexo_rating_done:',
  '@nexo_rating_skip:',
];

function isPersonalKey(key: string): boolean {
  return (
    PERSONAL_EXACT_KEYS.has(key) ||
    PERSONAL_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    SESSION_MEMORY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

const REGISTRATION_KEYS = new Set([
  '@nexo_pending_verify_email',
  '@nexo_pending_signup',
  '@nexo_password_recovery',
]);

async function removePersonalStorage(
  preserveRegistration = false,
  opts?: { preserveSessionMemory?: boolean },
): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const personalKeys = keys.filter((key) => {
    if (preserveRegistration && REGISTRATION_KEYS.has(key)) return false;
    if (opts?.preserveSessionMemory && SESSION_MEMORY_PREFIXES.some((p) => key.startsWith(p))) {
      return false;
    }
    return isPersonalKey(key);
  });
  if (personalKeys.length > 0) {
    await AsyncStorage.multiRemove(personalKeys);
  }
}

/**
 * Purga únicamente información de cuenta. Conserva ajustes del dispositivo
 * sin datos personales, como el idioma, y no toca las claves de sesión de Supabase.
 * @param opts.preserveSessionMemory — logout de la misma cuenta: no borrar lecturas de chat / cierres de valoración.
 */
export async function clearLocalUserData(opts?: { preserveSessionMemory?: boolean }): Promise<void> {
  // Invalida primero cualquier envío offline que estuviera todavía en curso.
  await Promise.all([discardChatOutbox(), discardOfflineActions()]);
  await removePersonalStorage(false, { preserveSessionMemory: opts?.preserveSessionMemory === true });
  cacheClearAll();
  clearAllScreenState();
  resetNotificationCategoryPrefsCache();
  resetPasswordRecoveryMemory();
}

/**
 * Impide hidratar datos de una cuenta distinta después de reiniciar la app.
 * Si no existe usuario activo, preserva un registro pendiente aún sin sesión.
 */
export async function reconcileLocalUserData(userId: string | null): Promise<void> {
  const previousUserId = await AsyncStorage.getItem(ACTIVE_USER_KEY);

  if (userId) {
    if (previousUserId !== userId) {
      // Incluye la primera ejecución tras actualizar desde una versión sin marcador.
      await clearLocalUserData();
    }
    await AsyncStorage.setItem(ACTIVE_USER_KEY, userId);
    return;
  }

  if (previousUserId) {
    await clearLocalUserData();
    return;
  }

  // En login sin cuenta activa, elimina restos de versiones antiguas pero
  // conserva solo lo necesario para completar registro/verificación/recuperación.
  await Promise.all([discardChatOutbox(), discardOfflineActions()]);
  await removePersonalStorage(true);
  cacheClearAll();
  clearAllScreenState();
  resetNotificationCategoryPrefsCache();
}
