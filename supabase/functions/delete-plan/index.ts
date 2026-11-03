import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  corsHeaders,
  createClients,
  jsonResponse,
  removeStoragePaths,
  requireUser,
} from '../_shared/destructiveCleanup.ts';
import {
  buildPushCopy,
  parsePushLang,
  resolveAvatarUrl,
} from '../_shared/pushCopy.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function notifyPlanCancelled(opts: {
  admin: ReturnType<typeof createClients>['admin'];
  planId: string;
  planTitle: string;
  actorId: string;
  recipientIds: string[];
}) {
  const { admin, planId, planTitle, actorId, recipientIds } = opts;
  const targets = [...new Set(recipientIds.filter((id) => id && id !== actorId))];
  if (!targets.length) return;

  const [{ data: actor }, { data: profiles }, { data: tokens }] = await Promise.all([
    admin.from('perfiles').select('nombre, avatar_url').eq('id', actorId).maybeSingle(),
    admin.from('perfiles').select('id, idioma, notificaciones_push, notif_social').in('id', targets),
    admin.from('push_tokens').select('user_id, token').in('user_id', targets),
  ]);

  const senderName = (actor?.nombre as string)?.trim() || 'Alguien';
  const avatarUrl = resolveAvatarUrl(actor?.avatar_url as string | null, senderName);
  const allowed = new Set(
    (profiles ?? [])
      .filter((p) => p.notificaciones_push !== false && p.notif_social !== false)
      .map((p) => p.id as string),
  );
  const langByUser = new Map(
    (profiles ?? []).map((p) => [p.id as string, parsePushLang(p.idioma)]),
  );

  const messages: Array<Record<string, unknown>> = [];
  for (const row of tokens ?? []) {
    const uid = row.user_id as string;
    const token = String(row.token ?? '');
    if (!token || !allowed.has(uid)) continue;
    const lang = langByUser.get(uid) ?? 'es';
    const copy = buildPushCopy({
      type: 'plan_cancelled',
      lang,
      senderName,
      planTitle,
      seed: `plan_cancelled:${planId}:${uid}`,
    });
    messages.push({
      to: token,
      title: copy.title,
      body: copy.body,
      data: {
        type: 'plan_cancelled',
        screen: 'my-plans',
        planId,
        avatarUrl,
        senderName,
      },
      sound: 'default',
      channelId: 'social',
      priority: 'high',
      collapseId: `plan-cancel:${planId}`,
      image: avatarUrl,
      mutableContent: true,
    });
  }

  if (!messages.length) return;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    }).catch(() => {});
  }
}

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
      admin.from('planes').select('creador_id, titulo').eq('id', planId).maybeSingle(),
      admin.from('perfiles').select('rol, baneado').eq('id', caller.id).maybeSingle(),
    ]);
    if (!plan) return jsonResponse(404, { error: 'plan_not_found' });
    const canDelete =
      callerProfile?.baneado !== true
      && (plan.creador_id === caller.id || callerProfile?.rol === 'owner');
    if (!canDelete) return jsonResponse(403, { error: 'not_authorized' });

    const { data: members } = await admin
      .from('participantes')
      .select('usuario_id')
      .eq('plan_id', planId)
      .eq('estado', 'aceptado');
    const recipientIds = (members ?? [])
      .map((m) => m.usuario_id as string)
      .filter((id) => id && id !== caller.id && id !== plan.creador_id);

    // Invitees con solicitud pendiente (para limpiar badge de perfil en cliente vía push).
    const { data: pendingInvites } = await admin
      .from('invitaciones_planes')
      .select('invitado_id')
      .eq('plan_id', planId)
      .eq('estado', 'pendiente');
    const inviteeIds = [...new Set(
      (pendingInvites ?? [])
        .map((r) => r.invitado_id as string)
        .filter((id) => id && id !== caller.id),
    )];

    // Avisar antes de borrar (el plan aún existe; luego desaparece).
    await notifyPlanCancelled({
      admin,
      planId,
      planTitle: (plan.titulo as string) || 'tu plan',
      actorId: caller.id,
      recipientIds: [...new Set([...recipientIds, ...inviteeIds])],
    }).catch(() => {});

    // Quitar tarjetas de invitación en chats de grupo que apuntan a este plan.
    await admin
      .from('mensajes')
      .delete()
      .like('contenido', `@@nexo_plan_invite:%"planId":"${planId}"%`)
      .then(() => undefined)
      .catch(() => undefined);

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

    return jsonResponse(200, { ok: true, clearedInvitees: inviteeIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_plan_failed';
    const status = message === 'not_authenticated' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});
