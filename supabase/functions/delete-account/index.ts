import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  corsHeaders,
  createClients,
  jsonResponse,
  removeStoragePaths,
  requireUser,
} from '../_shared/destructiveCleanup.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  try {
    const { userClient, admin } = createClients(req);
    const caller = await requireUser(userClient);
    const body = await req.json().catch(() => ({})) as { targetUserId?: unknown };
    const requestedTarget = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
    const targetUserId = requestedTarget || caller.id;

    if (!UUID_RE.test(targetUserId)) return jsonResponse(400, { error: 'invalid_target' });

    if (targetUserId !== caller.id) {
      const [{ data: callerProfile }, { data: targetProfile }] = await Promise.all([
        admin.from('perfiles').select('rol, baneado').eq('id', caller.id).maybeSingle(),
        admin.from('perfiles').select('rol').eq('id', targetUserId).maybeSingle(),
      ]);
      if (callerProfile?.rol !== 'owner' || callerProfile?.baneado === true) {
        return jsonResponse(403, { error: 'not_authorized' });
      }
      if (!targetProfile) return jsonResponse(404, { error: 'user_not_found' });
      if (targetProfile.rol === 'owner' || targetProfile.rol === 'admin') {
        return jsonResponse(403, { error: 'cannot_moderate_staff' });
      }
    }

    const { data: existingUser, error: lookupError } = await admin.auth.admin.getUserById(targetUserId);
    if (lookupError || !existingUser.user) return jsonResponse(404, { error: 'user_not_found' });

    const { data: paths, error: pathError } = await admin.rpc(
      'get_user_storage_cleanup_paths',
      { p_user_id: targetUserId },
    );
    if (pathError) throw new Error(`cleanup_paths_failed:${pathError.message}`);

    await removeStoragePaths(admin, paths);

    const { error: prepareError } = await admin.rpc('prepare_account_deletion', {
      p_user_id: targetUserId,
    });
    if (prepareError) throw new Error(`prepare_deletion_failed:${prepareError.message}`);

    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId, false);
    if (deleteError) throw new Error(`auth_delete_failed:${deleteError.message}`);

    return jsonResponse(200, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_account_failed';
    const status = message === 'not_authenticated' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});

