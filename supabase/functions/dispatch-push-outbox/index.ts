/**
 * Despacha eventos de push creados por PostgreSQL.
 *
 * Debe invocarse desde un Database Webhook de Supabase sobre INSERT en
 * public.push_notification_outbox. El webhook debe enviar:
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * También acepta { eventId: "<uuid>" } para reintentos internos.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type OutboxEvent = {
  id: string;
  event_type: 'plan_join_accepted' | 'plan_join_rejected';
  recipient_id: string;
  plan_id: string;
  plan_title: string;
};

type ExpoTicket = {
  status?: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'missing_env' }, 500);

  // Esta función no admite JWT de usuarios: solo el webhook/servicio interno.
  if (req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  let eventId = '';

  try {
    const payload = await req.json();
    eventId = String(payload?.eventId ?? payload?.record?.id ?? '');
    if (!eventId) return json({ error: 'event_id_required' }, 400);

    const { data: claimed, error: claimError } = await admin.rpc(
      'claim_push_outbox_event',
      { p_event_id: eventId },
    );
    if (claimError) throw new Error('outbox_claim_failed');

    const event = claimed as OutboxEvent | null;
    if (!event?.id) {
      return json({ sent: 0, skipped: true });
    }

    const { data: profile, error: profileError } = await admin
      .from('perfiles')
      .select('notificaciones_push, notif_social')
      .eq('id', event.recipient_id)
      .maybeSingle();
    if (profileError) throw new Error('profile_lookup_failed');

    if (profile?.notificaciones_push === false || profile?.notif_social === false) {
      await admin.rpc('complete_push_outbox_event', {
        p_event_id: event.id,
        p_succeeded: true,
        p_ticket_ids: [],
        p_error: null,
      });
      return json({ sent: 0, disabled: true });
    }

    const { data: tokenRows, error: tokenError } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', event.recipient_id);
    if (tokenError) throw new Error('token_lookup_failed');

    const tokens = [...new Set((tokenRows ?? []).map((row) => String(row.token)).filter(Boolean))];
    if (!tokens.length) {
      await admin.rpc('complete_push_outbox_event', {
        p_event_id: event.id,
        p_succeeded: true,
        p_ticket_ids: [],
        p_error: null,
      });
      return json({ sent: 0, no_tokens: true });
    }

    const accepted = event.event_type === 'plan_join_accepted';
    const messages = tokens.map((to) => ({
      to,
      title: accepted ? 'Solicitud aceptada' : 'Solicitud rechazada',
      body: accepted
        ? `Te han aceptado en «${event.plan_title}»`
        : `No te han aceptado en «${event.plan_title}»`,
      data: accepted
        ? { type: event.event_type, screen: 'plan', planId: event.plan_id }
        : { type: event.event_type, screen: 'feed' },
      sound: 'default',
      channelId: 'social',
      priority: 'default',
    }));

    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    if (!expoResponse.ok) throw new Error(`expo_push_${expoResponse.status}`);

    const expoJson = await expoResponse.json() as { data?: ExpoTicket[] };
    const tickets = expoJson.data ?? [];
    if (tickets.length !== messages.length) throw new Error('expo_invalid_ticket_count');

    const acceptedTicketIds: string[] = [];
    const deadTokens: string[] = [];
    const failures: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok' && ticket.id) {
        acceptedTicketIds.push(ticket.id);
        return;
      }
      const error = ticket.details?.error ?? ticket.message ?? 'expo_ticket_rejected';
      failures.push(error);
      if (error === 'DeviceNotRegistered') deadTokens.push(tokens[index]);
    });

    if (deadTokens.length) {
      await admin.from('push_tokens').delete().in('token', deadTokens);
    }

    // Al menos un ticket aceptado confirma que Expo recibió el aviso. Si todos
    // fallan, el evento vuelve a 'failed' y puede reintentarse.
    const succeeded = acceptedTicketIds.length > 0 || deadTokens.length === tokens.length;
    await admin.rpc('complete_push_outbox_event', {
      p_event_id: event.id,
      p_succeeded: succeeded,
      p_ticket_ids: acceptedTicketIds,
      p_error: succeeded ? null : failures.join('; '),
    });

    if (!succeeded) return json({ error: 'expo_rejected_all' }, 502);
    return json({
      sent: acceptedTicketIds.length,
      pruned: deadTokens.length,
      partial_failures: failures.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';

    // Si el evento ya se había adquirido, lo liberamos como fallido para que
    // pueda reintentarse. La RPC es segura aunque el id no esté processing.
    try {
      if (eventId) {
        await admin.rpc('complete_push_outbox_event', {
          p_event_id: eventId,
          p_succeeded: false,
          p_ticket_ids: null,
          p_error: message,
        });
      }
    } catch {
      // El lease expira a los cinco minutos incluso si no puede liberarse aquí.
    }

    return json({ error: message }, 502);
  }
});
