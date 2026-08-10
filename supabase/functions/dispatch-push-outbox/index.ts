/**
 * Despacha eventos de push creados por PostgreSQL.
 *
 * Se invoca cada minuto desde pg_cron. También acepta { eventId: "<uuid>" }
 * para procesar inmediatamente un evento concreto.
 *
 * Solo admite un secreto interno independiente configurado en Supabase Secrets.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type AdminClient = ReturnType<typeof createClient>;

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

type DispatchResult = {
  eventId: string;
  sent: number;
  skipped?: boolean;
  disabled?: boolean;
  no_tokens?: boolean;
  pruned?: number;
  partial_failures?: number;
  error?: string;
};

const MAX_BATCH_SIZE = 25;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function completeEvent(
  admin: AdminClient,
  eventId: string,
  succeeded: boolean,
  ticketIds: string[] | null,
  error: string | null,
): Promise<void> {
  const { error: completionError } = await admin.rpc('complete_push_outbox_event', {
    p_event_id: eventId,
    p_succeeded: succeeded,
    p_ticket_ids: ticketIds,
    p_error: error,
  });
  if (completionError) throw new Error('outbox_completion_failed');
}

async function dispatchEvent(
  admin: AdminClient,
  eventId: string,
): Promise<DispatchResult> {
  let claimedEventId = '';

  try {
    const { data: claimed, error: claimError } = await admin.rpc(
      'claim_push_outbox_event',
      { p_event_id: eventId },
    );
    if (claimError) throw new Error('outbox_claim_failed');

    const event = claimed as OutboxEvent | null;
    if (!event?.id) {
      return { eventId, sent: 0, skipped: true };
    }
    claimedEventId = event.id;

    const { data: profile, error: profileError } = await admin
      .from('perfiles')
      .select('notificaciones_push, notif_social')
      .eq('id', event.recipient_id)
      .maybeSingle();
    if (profileError) throw new Error('profile_lookup_failed');

    if (profile?.notificaciones_push === false || profile?.notif_social === false) {
      await completeEvent(admin, event.id, true, [], null);
      return { eventId: event.id, sent: 0, disabled: true };
    }

    const { data: tokenRows, error: tokenError } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', event.recipient_id);
    if (tokenError) throw new Error('token_lookup_failed');

    const tokens: string[] = [
      ...new Set<string>((tokenRows ?? []).map((row) => String(row.token)).filter(Boolean)),
    ];
    if (!tokens.length) {
      await completeEvent(admin, event.id, true, [], null);
      return { eventId: event.id, sent: 0, no_tokens: true };
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
      const { error: deleteError } = await admin
        .from('push_tokens')
        .delete()
        .in('token', deadTokens);
      if (deleteError) throw new Error('dead_token_cleanup_failed');
    }

    const succeeded = acceptedTicketIds.length > 0 || deadTokens.length === tokens.length;
    await completeEvent(
      admin,
      event.id,
      succeeded,
      acceptedTicketIds,
      succeeded ? null : failures.join('; '),
    );

    if (!succeeded) {
      return { eventId: event.id, sent: 0, error: 'expo_rejected_all' };
    }

    return {
      eventId: event.id,
      sent: acceptedTicketIds.length,
      pruned: deadTokens.length,
      partial_failures: failures.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';

    if (claimedEventId) {
      try {
        await completeEvent(admin, claimedEventId, false, null, message);
      } catch {
        // El lease expira aunque no pueda liberarse en esta petición.
      }
    }

    return { eventId, sent: 0, error: message };
  }
}

async function getDueEventIds(admin: AdminClient): Promise<string[]> {
  const { data, error } = await admin.rpc('get_due_push_outbox_event_ids', {
    p_limit: MAX_BATCH_SIZE,
  });

  if (error) throw new Error('outbox_due_lookup_failed');
  return (data ?? []).map((row: { id?: unknown }) => String(row.id ?? '')).filter(Boolean);
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const dispatchSecret = Deno.env.get('NEXO_DISPATCH_SECRET') ?? '';
  if (!supabaseUrl || !serviceKey || !dispatchSecret) {
    return json({ error: 'missing_env' }, 500);
  }

  // La función se despliega con --no-verify-jwt y aplica su propia autenticación.
  // Así el programador no necesita almacenar la clave administrativa service_role.
  if (req.headers.get('Authorization') !== `Bearer ${dispatchSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const payload = await req.json().catch(() => ({}));
    const requestedEventId = String(payload?.eventId ?? payload?.record?.id ?? '');

    const eventIds = requestedEventId
      ? [requestedEventId]
      : await getDueEventIds(admin);

    if (!eventIds.length) {
      return json({ processed: 0, sent: 0, failed: 0 });
    }

    const results: DispatchResult[] = [];
    for (const eventId of eventIds) {
      results.push(await dispatchEvent(admin, eventId));
    }

    const failed = results.filter((result) => Boolean(result.error)).length;
    return json({
      processed: results.length,
      sent: results.reduce((total, result) => total + result.sent, 0),
      failed,
      results,
    }, failed === results.length ? 502 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return json({ error: message }, 502);
  }
});
