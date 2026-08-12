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
    const body = await req.json().catch(() => ({})) as { planId?: unknown };
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    if (!UUID_RE.test(planId)) return jsonResponse(400, { error: 'invalid_target' });

    const [{ data: plan }, { data: callerProfile }] = await Promise.all([
      admin.from('planes').select('creador_id').eq('id', planId).maybeSingle(),
      admin.from('perfiles').select('rol, baneado').eq('id', caller.id).maybeSingle(),
    ]);
    if (!plan) return jsonResponse(404, { error: 'plan_not_found' });
    const canDelete =
      callerProfile?.baneado !== true
      && (plan.creador_id === caller.id || callerProfile?.rol === 'owner');
    if (!canDelete) return jsonResponse(403, { error: 'not_authorized' });

    const { data: paths, error: pathError } = await admin.rpc(
      'get_plan_storage_cleanup_paths',
      { p_plan_id: planId },
    );
    if (pathError) throw new Error(`cleanup_paths_failed:${pathError.message}`);

    await removeStoragePaths(admin, paths);

    const { error: deleteError } = await admin.rpc('service_delete_plan', {
      p_plan_id: planId,
      p_actor_id: caller.id,
    });
    if (deleteError) throw new Error(`plan_delete_failed:${deleteError.message}`);

    return jsonResponse(200, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_plan_failed';
    const status = message === 'not_authenticated' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});

