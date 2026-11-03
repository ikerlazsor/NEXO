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
    const body = await req.json().catch(() => ({})) as {
      targetUserId?: unknown;
      confirmDelete?: unknown;
    };
    const requestedTarget = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
    const targetUserId = requestedTarget || caller.id;
    const confirmDelete = body.confirmDelete === true;

    if (!UUID_RE.test(targetUserId)) return jsonResponse(400, { error: 'invalid_target' });

    // Antes de tocar storage: cancelar registro no puede vaciar una cuenta ya terminada.
    if (targetUserId === caller.id && !confirmDelete) {
      const { data: selfProfile, error: selfError } = await admin
        .from('perfiles')
        .select('registro_completado')
        .eq('id', caller.id)
        .maybeSingle();
      if (selfError) return jsonResponse(500, { error: 'profile_lookup_failed' });
      if (selfProfile?.registro_completado === true) {
        return jsonResponse(409, { error: 'account_already_registered' });
      }
    }

    if (targetUserId !== caller.id) {
      const [{ data: callerProfile }, { data: targetProfile }] = await Promise.all([
        admin.from('perfiles').select('rol, baneado').eq('id', caller.id).maybeSingle(),
        admin.from('perfiles').select('rol').eq('id', targetUserId).maybeSingle(),
      ]);
      if (callerProfile?.rol !== 'owner' || callerProfile?.baneado === true) {
        return jsonResponse(403, { error: 'not_authorized' });
      }
      if (!targetProfile && !(await admin.auth.admin.getUserById(targetUserId)).data.user) {
        return jsonResponse(404, { error: 'user_not_found' });
      }
      // Owner puede eliminar cualquier cuenta (admin incluida).
    }

    // Storage: best-effort.
    try {
      const { data: paths, error: pathError } = await admin.rpc(
        'get_user_storage_cleanup_paths',
        { p_user_id: targetUserId },
      );
      if (!pathError && paths) {
        try {
          await removeStoragePaths(admin, paths);
        } catch (storageErr) {
          console.error('storage_cleanup_skipped', storageErr);
        }
      }
    } catch (storageErr) {
      console.error('storage_cleanup_skipped', storageErr);
    }

    const { error: deleteError } = await admin.rpc('service_delete_account', {
      p_user_id: targetUserId,
      p_actor_id: caller.id,
      // Sin confirmDelete, un self-delete solo vale para un registro a medias.
      p_force: targetUserId !== caller.id || confirmDelete,
    });
    if (deleteError) {
      const msg = deleteError.message || 'delete_account_failed';
      if (/account_already_registered/i.test(msg)) {
        return jsonResponse(409, { error: 'account_already_registered' });
      }
      if (/not_authorized/i.test(msg)) return jsonResponse(403, { error: 'not_authorized' });
      if (/cannot_moderate_staff/i.test(msg)) return jsonResponse(403, { error: 'cannot_moderate_staff' });
      if (/invalid_target/i.test(msg)) return jsonResponse(400, { error: 'invalid_target' });
      if (/user_not_found/i.test(msg)) return jsonResponse(404, { error: 'user_not_found' });
      throw new Error(`service_delete_failed:${msg}`);
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_account_failed';
    const status = message === 'not_authenticated' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});
