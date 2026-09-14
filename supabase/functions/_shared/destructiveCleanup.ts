import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type CleanupPath = {
  bucket_id: string;
  object_name: string;
};

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function createClients(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('Authorization');

  if (!supabaseUrl || !anonKey || !serviceKey || !authorization) {
    throw new Error('missing_server_configuration_or_authorization');
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { userClient, admin };
}

export async function requireUser(
  userClient: ReturnType<typeof createClient>,
): Promise<{ id: string }> {
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error('not_authenticated');
  return { id: user.id };
}

export async function removeStoragePaths(
  admin: ReturnType<typeof createClient>,
  rows: CleanupPath[] | null,
): Promise<void> {
  const byBucket = new Map<string, Set<string>>();
  for (const row of rows ?? []) {
    if (!row?.bucket_id || !row?.object_name) continue;
    const names = byBucket.get(row.bucket_id) ?? new Set<string>();
    names.add(row.object_name);
    byBucket.set(row.bucket_id, names);
  }

  for (const [bucket, names] of byBucket.entries()) {
    const allNames = [...names];
    for (let offset = 0; offset < allNames.length; offset += 100) {
      const chunk = allNames.slice(offset, offset + 100);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) {
        console.error(`storage_cleanup_failed:${bucket}:${error.message}`);
      }
    }
  }
}

