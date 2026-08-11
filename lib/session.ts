import { clearLocalUserData } from './localDataPrivacy';
import { supabase } from './supabase';

type SignOutOptions = Parameters<typeof supabase.auth.signOut>[0];

export async function signOutAndClearLocalData(
  options?: SignOutOptions,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut(options);
  await clearLocalUserData();
  return { error: error?.message ?? null };
}
