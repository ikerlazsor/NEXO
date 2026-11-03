/**
 * Envía notificaciones push vía Expo Push API.
 * Secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (inyectados por defecto).
 *
 * Body (JSON):
 * {
 *   type: 'friend_request' | 'friend_accepted' | 'plan_join_request' | 'plan_joined'
 *       | 'plan_invite' | 'plan_message' | 'direct_message' | 'compliment' | 'spark'
 *       | 'plan_cancelled' | 'plan_updated',
 *   // aceptación se gestiona desde el outbox; rechazo y "te han valorado" no se envían
 *   ...campos según tipo
 * }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  buildPushCopy,
  parsePushLang,
  previewMessage,
  resolveAvatarUrl,
  type PushCopyType,
  type PushLang,
} from '../_shared/pushCopy.ts';

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
  image?: string;
  mutableContent?: boolean;
};

type ExpoDeliveryResult = {
  token: string;
  accepted: boolean;
  ticketId?: string;
  error?: string;
  dead: boolean;
};

type CopyContext = {
  type: PushCopyType;
  senderName: string;
  planTitle?: string;
  extraCount?: number;
  firstJoin?: boolean;
  messageTipo?: unknown;
  messageContenido?: unknown;
  trait?: string;
  place?: string;
  time?: string;
  changedDate?: boolean;
  changedPlace?: boolean;
};

async function sendExpo(messages: PushPayload[]): Promise<ExpoDeliveryResult[]> {
  if (!messages.length) return [];

  const results: ExpoDeliveryResult[] = [];
  for (let offset = 0; offset < messages.length; offset += 100) {
    const chunk = messages.slice(offset, offset + 100);
    let res: Response | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
      } catch (error) {
        lastError = error;
        res = null;
      }

      if (res?.ok) break;
      if (res) {
        lastError = new Error(`expo_push_${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }

    if (!res?.ok) {
      throw lastError instanceof Error ? lastError : new Error('expo_push_unavailable');
    }

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
          error === 'DeviceNotRegistered',
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

function isRecentMessage(createdAt: unknown): boolean {
  const timestamp = new Date(String(createdAt ?? '')).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= MAX_MESSAGE_AGE_MS;
}

function copyFor(lang: PushLang, ctx: CopyContext, seed: string) {
  return buildPushCopy({
    type: ctx.type,
    lang,
    senderName: ctx.senderName,
    planTitle: ctx.planTitle,
    extraCount: ctx.extraCount,
    firstJoin: ctx.firstJoin,
    trait: ctx.trait,
    place: ctx.place,
    time: ctx.time,
    changedDate: ctx.changedDate,
    changedPlace: ctx.changedPlace,
    messagePreview: previewMessage({
      tipo: ctx.messageTipo,
      contenido: ctx.messageContenido,
      lang,
    }),
    seed,
  });
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

    if (type === 'rated' || type === 'plan_join_rejected') {
      return new Response(JSON.stringify({ sent: 0, disabled: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: senderProfile } = await admin
      .from('perfiles')
      .select('nombre, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    const senderName = (senderProfile?.nombre as string)?.trim() || 'Alguien';
    let avatarUrl = resolveAvatarUrl(senderProfile?.avatar_url as string | null, senderName);

    let targetIds: string[] = [];
    let data: Record<string, string> = { type, avatarUrl, senderName };
    let category: NotifCategory = 'social';
    let collapseId: string | undefined;
    let claimedMessageId: string | null = null;
    let copyCtx: CopyContext = { type: 'friend_request', senderName };

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
      data = { type, screen: 'friends', otherUserId: user.id, avatarUrl, senderName };
      category = 'social';
      collapseId = `friend-req:${toUserId}`;
      copyCtx = { type: 'friend_request', senderName };
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
      // Quien envió la solicitud ve el perfil de quien aceptó.
      data = { type, screen: 'user-profile', otherUserId: user.id, avatarUrl, senderName };
      category = 'social';
      copyCtx = { type: 'friend_accepted', senderName };
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
      let extraCount = 0;
      let firstJoin = false;
      if (type === 'plan_join_request') {
        const { count } = await admin
          .from('participantes')
          .select('id', { count: 'exact', head: true })
          .eq('plan_id', planId)
          .eq('estado', 'pendiente');
        extraCount = Math.max(0, (count ?? 1) - 1);
      } else {
        const { count } = await admin
          .from('participantes')
          .select('id', { count: 'exact', head: true })
          .eq('plan_id', planId)
          .eq('estado', 'aceptado');
        firstJoin = (count ?? 0) <= 1;
      }
      data = { type, screen: 'plan', planId, avatarUrl, senderName };
      category = 'social';
      collapseId = `plan-social:${planId}`;
      copyCtx = {
        type: type === 'plan_join_request' ? 'plan_join_request' : 'plan_joined',
        senderName,
        planTitle,
        extraCount,
        firstJoin,
      };
    } else if (type === 'plan_join_accepted' || type === 'plan_join_rejected') {
      return new Response(JSON.stringify({ sent: 0, serverManaged: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } else if (type === 'plan_invite') {
      const planId = String(body.planId ?? '');
      const toUserId = String(body.toUserId ?? '');
      if (!planId || !toUserId) throw new Error('params');
      const { data: inv } = await admin
        .from('invitaciones_planes')
        .select('id, plan_id, tipo')
        .eq('plan_id', planId)
        .eq('invitador_id', user.id)
        .eq('invitado_id', toUserId)
        .eq('estado', 'pendiente')
        .maybeSingle();
      if (!inv) throw new Error('not_allowed');
      const { data: plan } = await admin.from('planes').select('titulo').eq('id', planId).maybeSingle();
      targetIds = [toUserId];
      data = {
        type,
        screen: 'plan',
        planId,
        inviteId: String(inv.id),
        otherUserId: user.id,
        inviteTipo: String(inv.tipo ?? 'invitacion'),
        avatarUrl,
        senderName,
      };
      category = 'social';
      copyCtx = {
        type: 'plan_invite',
        senderName,
        planTitle: (plan?.titulo as string) || undefined,
      };
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

      if (targetIds.length) {
        const { data: mutes } = await admin
          .from('push_chat_mutes')
          .select('user_id')
          .eq('plan_id', planId)
          .in('user_id', targetIds);
        const muted = new Set((mutes ?? []).map((m) => m.user_id as string));
        targetIds = targetIds.filter((id) => !muted.has(id));
      }

      data = { type, screen: 'chat', planId, avatarUrl, senderName };
      category = 'messages';
      collapseId = `plan-msg:${planId}`;
      copyCtx = {
        type: 'plan_message',
        senderName,
        planTitle: (plan?.titulo as string) || undefined,
        messageTipo: message.tipo,
        messageContenido: message.contenido,
      };
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

      const { data: blocked, error: blockError } = await admin.rpc('users_are_blocked', {
        p_a: user.id,
        p_b: toUserId,
      });
      if (blockError) throw new Error('block_check_failed');
      if (blocked === true) throw new Error('not_allowed');

      claimedMessageId = String(message.id);
      targetIds = [toUserId];
      data = { type, screen: 'direct-chat', otherUserId: user.id, avatarUrl, senderName };
      category = 'messages';
      collapseId = `dm:${[user.id, toUserId].sort().join(':')}`;
      copyCtx = {
        type: 'direct_message',
        senderName,
        messageTipo: message.tipo,
        messageContenido: message.contenido,
      };
    } else if (type === 'compliment' || type === 'spark') {
      const toUserId = readUuid(body.toUserId, 'toUserId');
      const planId = readUuid(body.planId, 'planId');
      if (toUserId === user.id) throw new Error('not_allowed');

      const { data: parts } = await admin
        .from('participantes')
        .select('usuario_id, estado')
        .eq('plan_id', planId)
        .in('usuario_id', [user.id, toUserId])
        .eq('estado', 'aceptado');
      const accepted = new Set((parts ?? []).map((row) => row.usuario_id as string));
      if (!accepted.has(user.id) || !accepted.has(toUserId)) throw new Error('not_allowed');

      const { data: mine } = await admin
        .from('valoraciones')
        .select('repetiria_experiencia, aspectos_positivos')
        .eq('plan_id', planId)
        .eq('evaluador_id', user.id)
        .eq('evaluado_id', toUserId)
        .maybeSingle();
      if (!mine) throw new Error('not_allowed');

      const { data: plan } = await admin
        .from('planes')
        .select('titulo')
        .eq('id', planId)
        .maybeSingle();
      const planTitle = (plan?.titulo as string) || undefined;
      const pos = Array.isArray(mine.aspectos_positivos)
        ? (mine.aspectos_positivos as string[]).filter((key) => typeof key === 'string' && key.length > 0)
        : [];
      const traitRaw = String(body.trait ?? pos[0] ?? '').trim();

      if (type === 'spark') {
        if (mine.repetiria_experiencia !== 'si') throw new Error('not_allowed');
        const { data: theirs } = await admin
          .from('valoraciones')
          .select('repetiria_experiencia')
          .eq('plan_id', planId)
          .eq('evaluador_id', toUserId)
          .eq('evaluado_id', user.id)
          .maybeSingle();
        if (theirs?.repetiria_experiencia !== 'si') throw new Error('not_allowed');
        targetIds = [toUserId];
        data = {
          type,
          screen: 'user-profile',
          otherUserId: user.id,
          planId,
          avatarUrl,
          senderName,
        };
        category = 'social';
        collapseId = `spark:${planId}:${[user.id, toUserId].sort().join(':')}`;
        copyCtx = { type: 'spark', senderName, planTitle };
      } else {
        if (pos.length === 0) throw new Error('not_allowed');
        const trait = pos.includes(traitRaw) ? traitRaw : pos[0];
        const anonName = 'Alguien';
        avatarUrl = resolveAvatarUrl(null, 'Nexo!');
        targetIds = [toUserId];
        data = {
          type,
          screen: 'profile',
          planId,
          avatarUrl,
          senderName: anonName,
        };
        category = 'social';
        collapseId = `compliment:${planId}:${toUserId}`;
        copyCtx = {
          type: 'compliment',
          senderName: anonName,
          planTitle,
          trait,
        };
      }
    } else if (type === 'plan_cancelled' || type === 'plan_updated') {
      const planId = readUuid(body.planId, 'planId');
      const { data: plan } = await admin
        .from('planes')
        .select('id, titulo, creador_id, fecha_evento, nombre_ubicacion')
        .eq('id', planId)
        .maybeSingle();
      if (!plan?.creador_id) throw new Error('not_allowed');

      const { data: callerProfile } = await admin
        .from('perfiles')
        .select('rol')
        .eq('id', user.id)
        .maybeSingle();
      const isOwner = callerProfile?.rol === 'owner';
      if (plan.creador_id !== user.id && !isOwner) throw new Error('not_allowed');

      const { data: members } = await admin
        .from('participantes')
        .select('usuario_id')
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');
      const ids = new Set<string>((members ?? []).map((m) => m.usuario_id as string));
      ids.delete(user.id);
      ids.delete(plan.creador_id as string);
      targetIds = [...ids];

      const planTitle = (plan.titulo as string) || undefined;
      const place = String(plan.nombre_ubicacion ?? '').trim();
      let time = '';
      if (plan.fecha_evento) {
        try {
          time = new Date(String(plan.fecha_evento)).toLocaleString('es-ES', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          time = '';
        }
      }

      if (type === 'plan_cancelled') {
        data = { type, screen: 'my-plans', planId, avatarUrl, senderName };
        category = 'social';
        collapseId = `plan-cancel:${planId}`;
        copyCtx = { type: 'plan_cancelled', senderName, planTitle };
      } else {
        const changedDate = body.changedDate === true || body.changedDate === 'true';
        const changedPlace = body.changedPlace === true || body.changedPlace === 'true';
        if (!changedDate && !changedPlace) {
          return new Response(JSON.stringify({ sent: 0, skipped: true }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }
        // Prefer client-provided formatted time/place (already localized), else DB.
        const bodyTime = String(body.time ?? '').trim();
        const bodyPlace = String(body.place ?? '').trim();
        data = { type, screen: 'plan', planId, avatarUrl, senderName };
        category = 'social';
        collapseId = `plan-update:${planId}`;
        copyCtx = {
          type: 'plan_updated',
          senderName,
          planTitle,
          place: bodyPlace || place,
          time: bodyTime || time,
          changedDate,
          changedPlace,
        };
      }
    } else {
      return new Response(JSON.stringify({ error: 'unknown_type' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    targetIds = [...new Set(targetIds.filter(Boolean))];

    // Nadie recibe avisos de alguien con quien hay un bloqueo, en cualquier dirección.
    if (targetIds.length) {
      const { data: blockRows } = await admin
        .from('bloqueos')
        .select('bloqueador_id, bloqueado_id')
        .or(`bloqueador_id.eq.${user.id},bloqueado_id.eq.${user.id}`);
      if (blockRows?.length) {
        const blockedIds = new Set<string>(
          blockRows.map((row) =>
            row.bloqueador_id === user.id
              ? (row.bloqueado_id as string)
              : (row.bloqueador_id as string),
          ),
        );
        targetIds = targetIds.filter((id) => !blockedIds.has(id));
      }
    }

    if (!targetIds.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let prefsQuery = await admin
      .from('perfiles')
      .select('id, notificaciones_push, notif_messages, notif_social, idioma')
      .in('id', targetIds);
    if (prefsQuery.error) {
      prefsQuery = await admin
        .from('perfiles')
        .select('id, notificaciones_push, notif_messages, notif_social')
        .in('id', targetIds);
    }

    const allowedPrefs = (prefsQuery.data ?? []).filter((p) => {
      if (p.notificaciones_push === false) return false;
      if (category === 'messages' && p.notif_messages === false) return false;
      if (category === 'social' && p.notif_social === false) return false;
      return true;
    });
    const langByUser = new Map<string, PushLang>(
      allowedPrefs.map((p) => [p.id as string, parsePushLang((p as { idioma?: unknown }).idioma)]),
    );
    const allowed = allowedPrefs.map((p) => p.id as string);

    if (!allowed.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: tokens } = await admin
      .from('push_tokens')
      .select('token, user_id')
      .in('user_id', allowed);

    const channelId = channelFor(category);
    const messages: PushPayload[] = (tokens ?? []).map((row) => {
      const uid = row.user_id as string;
      const lang = langByUser.get(uid) ?? 'es';
      const copy = copyFor(lang, copyCtx, `${copyCtx.type}:${uid}:${data.planId ?? ''}`);
      return {
        to: row.token as string,
        title: copy.title,
        body: copy.body,
        data,
        sound: 'default' as const,
        channelId,
        priority: category === 'messages' ? 'high' as const : 'default' as const,
        image: avatarUrl,
        mutableContent: true,
        ...(collapseId ? { collapseId } : {}),
      };
    });

    let queuedMessages = messages;

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
