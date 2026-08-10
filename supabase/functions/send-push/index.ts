/**
 * Envía notificaciones push vía Expo Push API.
 * Secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (inyectados por defecto).
 *
 * Body (JSON):
 * {
 *   type: 'friend_request' | 'friend_accepted' | 'plan_join_request' | 'plan_joined'
 *       | 'plan_join_accepted' | 'plan_join_rejected' | 'plan_invite'
 *       | 'plan_message' | 'direct_message' | 'rated',
 *   ...campos según tipo
 * }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type NotifCategory = 'messages' | 'social';

type PushPayload = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  collapseId?: string;
};

type ExpoDeliveryResult = {
  token: string;
  accepted: boolean;
  ticketId?: string;
  error?: string;
  dead: boolean;
};

async function sendExpo(messages: PushPayload[]): Promise<ExpoDeliveryResult[]> {
  if (!messages.length) return [];

  const results: ExpoDeliveryResult[] = [];
  for (let offset = 0; offset < messages.length; offset += 100) {
    const chunk = messages.slice(offset, offset + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`expo_push_${res.status}`);

    const json = await res.json() as {
      data?: Array<{
        status?: 'ok' | 'error';
        id?: string;
        details?: { error?: string };
        message?: string;
      }>;
    };
    const tickets = json.data ?? [];
    if (tickets.length !== chunk.length) throw new Error('expo_invalid_ticket_count');

    tickets.forEach((ticket, idx) => {
      const token = chunk[idx].to;
      const error = ticket.details?.error ?? ticket.message;
      results.push({
        token,
        accepted: ticket.status === 'ok' && Boolean(ticket.id),
        ...(ticket.id ? { ticketId: ticket.id } : {}),
        ...(error ? { error } : {}),
        dead:
          ticket.status === 'error' &&
          (error === 'DeviceNotRegistered' || error === 'InvalidCredentials'),
      });
    });
  }

  return results;
}

function channelFor(category: NotifCategory): string {
  return category === 'messages' ? 'messages' : 'social';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

function readUuid(value: unknown, field: string): string {
  const parsed = String(value ?? '').trim();
  if (!UUID_RE.test(parsed)) throw new Error(field);
  return parsed;
}

function messagePreview(message: { contenido?: unknown; tipo?: unknown }): string {
  const type = String(message.tipo ?? 'texto');
  if (type === 'imagen') return '📷 Foto';
  if (type === 'video') return '🎬 Vídeo';
  if (type === 'audio') return '🎤 Audio';

  let content = String(message.contenido ?? '');
  const mark = '@@nexo_reply:';
  if (content.startsWith(mark)) {
    const end = content.indexOf('@@\n', mark.length);
    if (end >= 0) content = content.slice(end + 3);
  }
  return content.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Mensaje';
}

function isRecentMessage(createdAt: unknown): boolean {
  const timestamp = new Date(String(createdAt ?? '')).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= MAX_MESSAGE_AGE_MS;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'missing_env' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: quotaAllowed, error: quotaError } = await admin.rpc(
      'consume_push_dispatch_quota',
      { p_user_id: user.id },
    );
    if (quotaError) throw new Error('push_quota_unavailable');
    if (quotaAllowed !== true) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const type = String(body?.type ?? '');

    const { data: senderProfile } = await admin
      .from('perfiles')
      .select('nombre')
      .eq('id', user.id)
      .maybeSingle();
    const senderName = (senderProfile?.nombre as string)?.trim() || 'Alguien';

    let targetIds: string[] = [];
    let title = 'Nexo';
    let notifBody = '';
    let data: Record<string, string> = { type };
    let category: NotifCategory = 'social';
    let collapseId: string | undefined;
    let claimedMessageId: string | null = null;

    if (type === 'friend_request') {
      const toUserId = String(body.toUserId ?? '');
      if (!toUserId) throw new Error('toUserId');
      const { data: row } = await admin
        .from('amistades')
        .select('id')
        .eq('usuario_origen_id', user.id)
        .eq('usuario_destino_id', toUserId)
        .eq('estado', 'pendiente')
        .maybeSingle();
      if (!row) throw new Error('not_allowed');
      targetIds = [toUserId];
      title = 'Solicitud de amistad';
      notifBody = `${senderName} te ha enviado una solicitud de amistad`;
      data = { type, screen: 'friends' };
      category = 'social';
    } else if (type === 'friend_accepted') {
      const toUserId = String(body.toUserId ?? '');
      if (!toUserId) throw new Error('toUserId');
      const { data: row } = await admin
        .from('amistades')
        .select('id')
        .eq('usuario_origen_id', toUserId)
        .eq('usuario_destino_id', user.id)
        .eq('estado', 'aceptado')
        .maybeSingle();
      if (!row) throw new Error('not_allowed');
      targetIds = [toUserId];
      title = 'Amistad aceptada';
      notifBody = `${senderName} ha aceptado tu solicitud de amistad`;
      data = { type, screen: 'friends' };
      category = 'social';
    } else if (type === 'plan_join_request' || type === 'plan_joined') {
      const planId = String(body.planId ?? '');
      if (!planId) throw new Error('planId');
      const { data: plan } = await admin
        .from('planes')
        .select('id, titulo, creador_id')
        .eq('id', planId)
        .maybeSingle();
      if (!plan?.creador_id || plan.creador_id === user.id) throw new Error('not_allowed');
      const expectedState = type === 'plan_join_request' ? 'pendiente' : 'aceptado';
      const { data: part } = await admin
        .from('participantes')
        .select('estado')
        .eq('plan_id', planId)
        .eq('usuario_id', user.id)
        .eq('estado', expectedState)
        .maybeSingle();
      if (!part) throw new Error('not_allowed');
      targetIds = [plan.creador_id as string];
      const planTitle = (plan.titulo as string) || 'tu plan';
      if (type === 'plan_join_request') {
        title = 'Solicitud para unirse';
        notifBody = `${senderName} quiere unirse a «${planTitle}»`;
      } else {
        title = 'Nuevo participante';
        notifBody = `${senderName} se ha unido a «${planTitle}»`;
      }
      data = { type, screen: 'plan', planId };
      category = 'social';
      collapseId = `plan-social:${planId}`;
    } else if (type === 'plan_join_accepted' || type === 'plan_join_rejected') {
      // Desde la fase 4 estos eventos solo se generan y despachan desde el
      // outbox de PostgreSQL. Un JWT de usuario nunca puede elegir el resultado
      // ni el destinatario de esta notificación.
      return new Response(JSON.stringify({ error: 'server_managed_notification' }), {
        status: 409,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } else if (type === 'plan_invite') {
      const planId = String(body.planId ?? '');
      const toUserId = String(body.toUserId ?? '');
      if (!planId || !toUserId) throw new Error('params');
      const { data: inv } = await admin
        .from('invitaciones_planes')
        .select('id, plan_id')
        .eq('plan_id', planId)
        .eq('invitador_id', user.id)
        .eq('invitado_id', toUserId)
        .eq('estado', 'pendiente')
        .maybeSingle();
      if (!inv) throw new Error('not_allowed');
      const { data: plan } = await admin.from('planes').select('titulo').eq('id', planId).maybeSingle();
      targetIds = [toUserId];
      title = 'Invitación a un plan';
      notifBody = `${senderName} te ha invitado a «${(plan?.titulo as string) || 'un plan'}»`;
      data = { type, screen: 'plan', planId };
      category = 'social';
    } else if (type === 'plan_message') {
      const planId = readUuid(body.planId, 'planId');
      const requestedMessageId = body.messageId
        ? readUuid(body.messageId, 'messageId')
        : null;
      const { data: part } = await admin
        .from('participantes')
        .select('id')
        .eq('plan_id', planId)
        .eq('usuario_id', user.id)
        .eq('estado', 'aceptado')
        .maybeSingle();
      const { data: plan } = await admin
        .from('planes')
        .select('titulo, creador_id')
        .eq('id', planId)
        .maybeSingle();
      if (!part && plan?.creador_id !== user.id) throw new Error('not_allowed');

      let messageQuery = admin
        .from('mensajes')
        .select('id, contenido, tipo, creado_en')
        .eq('plan_id', planId)
        .eq('emisor_id', user.id);
      if (requestedMessageId) {
        messageQuery = messageQuery.eq('id', requestedMessageId);
      }
      const { data: message, error: messageError } = await messageQuery
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (messageError || !message || !isRecentMessage(message.creado_en)) {
        throw new Error('invalid_message');
      }
      claimedMessageId = String(message.id);

      const { data: members } = await admin
        .from('participantes')
        .select('usuario_id')
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');
      const ids = new Set<string>((members ?? []).map((m) => m.usuario_id as string));
      if (plan?.creador_id) ids.add(plan.creador_id as string);
      ids.delete(user.id);
      targetIds = [...ids];

      // Respetar silenciar chat (app cerrada)
      if (targetIds.length) {
        const { data: mutes } = await admin
          .from('push_chat_mutes')
          .select('user_id')
          .eq('plan_id', planId)
          .in('user_id', targetIds);
        const muted = new Set((mutes ?? []).map((m) => m.user_id as string));
        targetIds = targetIds.filter((id) => !muted.has(id));
      }

      title = (plan?.titulo as string) || 'Chat del plan';
      notifBody = `${senderName}: ${messagePreview(message)}`;
      data = { type, screen: 'chat', planId };
      category = 'messages';
      collapseId = `plan-msg:${planId}`;
    } else if (type === 'direct_message') {
      const toUserId = readUuid(body.toUserId, 'toUserId');
      const requestedMessageId = body.messageId
        ? readUuid(body.messageId, 'messageId')
        : null;
      if (toUserId === user.id) throw new Error('not_allowed');

      let messageQuery = admin
        .from('mensajes')
        .select('id, contenido, tipo, creado_en')
        .eq('emisor_id', user.id)
        .eq('receptor_id', toUserId)
        .is('plan_id', null);
      if (requestedMessageId) {
        messageQuery = messageQuery.eq('id', requestedMessageId);
      }
      const { data: message, error: messageError } = await messageQuery
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (messageError || !message || !isRecentMessage(message.creado_en)) {
        throw new Error('invalid_message');
      }

      const { data: blocks, error: blockError } = await admin
        .from('bloqueos')
        .select('id')
        .or(
          `and(usuario_origen_id.eq.${user.id},usuario_destino_id.eq.${toUserId}),and(usuario_origen_id.eq.${toUserId},usuario_destino_id.eq.${user.id})`,
        )
        .limit(1);
      if (blockError) throw new Error('block_check_failed');
      if ((blocks ?? []).length > 0) throw new Error('not_allowed');

      claimedMessageId = String(message.id);
      targetIds = [toUserId];
      title = senderName;
      notifBody = messagePreview(message);
      data = { type, screen: 'direct-chat', otherUserId: user.id };
      category = 'messages';
      collapseId = `dm:${[user.id, toUserId].sort().join(':')}`;
    } else if (type === 'rated') {
      const toUserId = String(body.toUserId ?? '');
      const planId = String(body.planId ?? '');
      if (!toUserId || !planId) throw new Error('params');
      const { data: row } = await admin
        .from('valoraciones')
        .select('id')
        .eq('plan_id', planId)
        .eq('evaluador_id', user.id)
        .eq('evaluado_id', toUserId)
        .maybeSingle();
      if (!row) throw new Error('not_allowed');
      targetIds = [toUserId];
      title = 'Nueva valoración';
      notifBody = `${senderName} te ha valorado en Nexo`;
      data = { type, screen: 'profile', planId };
      category = 'social';
    } else {
      return new Response(JSON.stringify({ error: 'unknown_type' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    targetIds = [...new Set(targetIds.filter(Boolean))];
    if (!targetIds.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: prefs } = await admin
      .from('perfiles')
      .select('id, notificaciones_push, notif_messages, notif_social')
      .in('id', targetIds);

    const allowed = (prefs ?? [])
      .filter((p) => {
        if (p.notificaciones_push === false) return false;
        if (category === 'messages' && p.notif_messages === false) return false;
        if (category === 'social' && p.notif_social === false) return false;
        return true;
      })
      .map((p) => p.id as string);

    if (!allowed.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: tokens } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', allowed);

    const channelId = channelFor(category);
    const messages: PushPayload[] = (tokens ?? []).map((row) => ({
      to: row.token as string,
      title,
      body: notifBody,
      data,
      sound: 'default',
      channelId,
      priority: category === 'messages' ? 'high' : 'default',
      ...(collapseId ? { collapseId } : {}),
    }));

    let queuedMessages = messages;

    // La idempotencia de mensajes se controla por dispositivo. Un fallo en un
    // token no bloquea los demás y una entrega fallida puede reintentarse.
    if (claimedMessageId) {
      const claims = await Promise.all(
        messages.map(async (message) => {
          const { data: claimed, error: claimError } = await admin.rpc(
            'claim_push_message_delivery',
            {
              p_message_id: claimedMessageId,
              p_sender_id: user.id,
              p_push_token: message.to,
            },
          );
          if (claimError) throw new Error('push_claim_unavailable');
          return claimed === true;
        }),
      );
      queuedMessages = messages.filter((_, index) => claims[index]);

      if (!queuedMessages.length) {
        return new Response(JSON.stringify({ sent: 0, duplicate: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    let deliveryResults: ExpoDeliveryResult[];
    try {
      deliveryResults = await sendExpo(queuedMessages);
    } catch (error) {
      if (claimedMessageId) {
        const failure = error instanceof Error ? error.message : 'expo_delivery_failed';
        await Promise.all(
          queuedMessages.map((message) =>
            admin.rpc('complete_push_message_delivery', {
              p_message_id: claimedMessageId,
              p_sender_id: user.id,
              p_push_token: message.to,
              p_succeeded: false,
              p_ticket_id: null,
              p_error: failure,
            })
          ),
        );
      }
      throw error;
    }

    if (claimedMessageId) {
      await Promise.all(
        deliveryResults.map((result) =>
          admin.rpc('complete_push_message_delivery', {
            p_message_id: claimedMessageId,
            p_sender_id: user.id,
            p_push_token: result.token,
            p_succeeded: result.accepted,
            p_ticket_id: result.ticketId ?? null,
            p_error: result.accepted ? null : (result.error ?? 'expo_ticket_rejected'),
          })
        ),
      );
    }

    const deadTokens = deliveryResults.filter((result) => result.dead).map((result) => result.token);
    if (deadTokens.length) {
      await admin.from('push_tokens').delete().in('token', deadTokens);
    }

    const acceptedCount = deliveryResults.filter((result) => result.accepted).length;
    return new Response(JSON.stringify({
      sent: acceptedCount,
      rejected: deliveryResults.length - acceptedCount,
      pruned: deadTokens.length,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
