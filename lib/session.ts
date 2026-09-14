import { clearLocalUserData } from './localDataPrivacy';
import { supabase } from './supabase';

type SignOutOptions = Parameters<typeof supabase.auth.signOut>[0];

export async function signOutAndClearLocalData(
  options?: SignOutOptions,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut(options);
  // Misma cuenta en este dispositivo: conservar lecturas de chat y valoraciones cerradas.
  await clearLocalUserData({ preserveSessionMemory: true });
  return { error: error?.message ?? null };
}
