import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../lib/supabase";

// Public discovery must not queue behind session initialization/token refresh.
// accessToken bypasses GoTrue entirely: this client never stores a session.
// Membership, people, chat and historical detail keep using the session client.
export const publicCatalog = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => SUPABASE_ANON_KEY,
});
