import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/destructiveCleanup.ts';

/**
 * Moderación de planes con OpenAI omni-moderation (gratuita): título,
 * descripción y portadas subidas por el usuario.
 *
 * Dos entradas:
 * - App (JWT del usuario): { title, description, images } → veredicto antes de publicar.
 * - Base de datos (pg_net + secreto): { plan_id } → revisa lo guardado. Atrapa a
 *   quien publique sin pasar por la app o con una versión antigua.
 *
 * Veredictos: ok | review (se publica y va a la cola del admin) | block.
 * Si OpenAI falla se devuelve ok (fail-open): la lista mínima de la base de datos
 * sigue bloqueando lo inequívoco.
 */

type Verdict = 'ok' | 'review' | 'block';
type Reason = 'minors' | 'sexual' | 'hate' | 'harassment' | 'violence' | 'illicit' | 'self_harm';
type Scores = Record<string, number>;

// [categoría, revisar desde, bloquear desde, motivo]
// Calibrado con textos reales de planes: lo normal (boxeo, paintball, "matar el
// tiempo", "porra del Madrid") puntúa < 0,12; "Matar a gente" 0,77.
const TEXT_RULES: Array<[string, number, number, Reason]> = [
  ['sexual/minors', 0.1, 0.3, 'minors'],
  ['sexual', 0.4, 0.7, 'sexual'],
  ['hate/threatening', 0.2, 0.4, 'hate'],
  ['hate', 0.3, 0.6, 'hate'],
  ['harassment/threatening', 0.25, 0.4, 'harassment'],
  ['harassment', 0.4, 0.7, 'harassment'],
  ['illicit/violent', 0.3, 0.6, 'illicit'],
  ['illicit', 0.15, 0.25, 'illicit'],
  ['self-harm/instructions', 0.3, 0.5, 'self_harm'],
  ['self-harm/intent', 0.3, 0.5, 'self_harm'],
  ['self-harm', 0.3, 0.5, 'self_harm'],
  ['violence/graphic', 0.4, 0.7, 'violence'],
  ['violence', 0.3, 0.6, 'violence'],
];

// Fotos: más margen (deporte de contacto, disfraces, conciertos…).
const IMAGE_RULES: Array<[string, number, number, Reason]> = [
  ['sexual/minors', 0.1, 0.3, 'minors'],
  ['sexual', 0.5, 0.8, 'sexual'],
  ['self-harm', 0.5, 0.8, 'self_harm'],
  ['self-harm/intent', 0.5, 0.8, 'self_harm'],
  ['self-harm/instructions', 0.5, 0.8, 'self_harm'],
  ['violence/graphic', 0.5, 0.8, 'violence'],
  ['violence', 0.8, 0.95, 'violence'],
];

const MAX_IMAGES = 6;
const MAX_TEXT = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing_${name.toLowerCase()}`);
  return v;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isUserImage(url: string): boolean {
  // Las portadas de la galería son nuestras: solo se revisan las subidas (http/https).
  return /^https:\/\//i.test(url);
}

async function moderateInput(input: unknown): Promise<Scores> {
  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'omni-moderation-latest', input }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const json = await res.json() as { results?: Array<{ category_scores?: Scores }> };
  const merged: Scores = {};
  for (const r of json.results ?? []) {
    for (const [k, v] of Object.entries(r.category_scores ?? {})) {
      merged[k] = Math.max(merged[k] ?? 0, Number(v) || 0);
    }
  }
  return merged;
}

function judge(
  scores: Scores,
  rules: Array<[string, number, number, Reason]>,
): { verdict: Verdict; reason: Reason | null } {
  let review: Reason | null = null;
  for (const [cat, reviewAt, blockAt, reason] of rules) {
    const s = scores[cat] ?? 0;
    if (s >= blockAt) return { verdict: 'block', reason };
    if (s >= reviewAt && !review) review = reason;
  }
  return review ? { verdict: 'review', reason: review } : { verdict: 'ok', reason: null };
}

function maxScores(list: Scores[]): Scores {
  const out: Scores = {};
  for (const s of list) {
    for (const [k, v] of Object.entries(s)) out[k] = Math.max(out[k] ?? 0, v);
  }
  return out;
}

async function moderateContent(
  title: string,
  description: string,
  images: string[],
): Promise<{ verdict: Verdict; reason: Reason | null; scores: Scores }> {
  const full = [title, description].map((x) => x.trim()).filter(Boolean).join('\n\n').slice(0, MAX_TEXT);
  // El título también por separado: una descripción larga no lo "diluye".
  const texts = Array.from(new Set([title.trim(), full].filter(Boolean)));
  const textJob = texts.length ? moderateInput(texts) : Promise.resolve({} as Scores);
  const imageJobs = images.filter(isUserImage).slice(0, MAX_IMAGES).map((url) =>
    moderateInput([{ type: 'image_url', image_url: { url } }])
  );
  const [textScores, ...imageScoreList] = await Promise.all([textJob, ...imageJobs]);
  const imageScores = maxScores(imageScoreList);
  const byText = judge(textScores, TEXT_RULES);
  const byImage = judge(imageScores, IMAGE_RULES);
  const rank = { ok: 0, review: 1, block: 2 } as const;
  const worst = rank[byImage.verdict] > rank[byText.verdict] ? byImage : byText;
  return { ...worst, scores: maxScores([textScores, imageScores]) };
}

function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function handleWebhook(planId: string): Promise<Response> {
  const admin = adminClient();
  const { data: plan } = await admin
    .from('planes')
    .select('id, creador_id, titulo, descripcion, imagen_url, imagenes_url, creado_en, estado')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return jsonResponse(200, { skipped: 'not_found' });

  const images = Array.from(new Set([
    ...(Array.isArray(plan.imagenes_url) ? plan.imagenes_url : []),
    plan.imagen_url ?? '',
  ].filter((u: unknown): u is string => typeof u === 'string' && !!u)));
  const title = String(plan.titulo ?? '');
  const description = String(plan.descripcion ?? '');
  const hash = await sha256(JSON.stringify([title, description, images]));

  const { data: prev } = await admin
    .from('moderacion_planes')
    .select('content_hash')
    .eq('plan_id', planId)
    .maybeSingle();
  if (prev?.content_hash === hash) return jsonResponse(200, { skipped: 'unchanged' });

  let result: Awaited<ReturnType<typeof moderateContent>>;
  try {
    result = await moderateContent(title, description, images);
  } catch (e) {
    await admin.from('moderacion_planes').upsert({
      plan_id: planId, content_hash: null, veredicto: 'error', motivo: String(e).slice(0, 200),
      puntuaciones: null, revisado_en: new Date().toISOString(),
    });
    return jsonResponse(200, { verdict: 'error' });
  }

  await admin.from('moderacion_planes').upsert({
    plan_id: planId,
    content_hash: hash,
    veredicto: result.verdict,
    motivo: result.reason,
    puntuaciones: result.scores,
    revisado_en: new Date().toISOString(),
  });

  if (result.verdict === 'ok') return jsonResponse(200, { verdict: 'ok' });

  // Cola del panel de admin (reportes_planes) a nombre del owner.
  const { data: owner } = await admin.from('perfiles').select('id').eq('rol', 'owner').limit(1).maybeSingle();
  let hidden = false;
  if (result.verdict === 'block' && plan.estado !== 'cancelado') {
    // Recién creado y sin nadie más dentro: se retira sin molestar a nadie.
    const { count } = await admin
      .from('participantes')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', planId)
      .eq('estado', 'aceptado')
      .neq('usuario_id', plan.creador_id);
    if ((count ?? 0) === 0) {
      const { error } = await admin.from('planes').update({ estado: 'cancelado' }).eq('id', planId);
      hidden = !error;
    }
  }
  if (owner?.id) {
    await admin.from('reportes_planes').insert({
      plan_id: planId,
      reportador_id: owner.id,
      motivo: 'Moderación automática',
      mensaje: `${result.verdict === 'block' ? 'Bloqueado' : 'Para revisar'} (${result.reason})${hidden ? ' · plan retirado' : ''}`,
      plan_titulo: title.slice(0, 200),
    });
  }
  return jsonResponse(200, { verdict: result.verdict, reason: result.reason, hidden });
}

async function handleApp(req: Request): Promise<Response> {
  const authorization = req.headers.get('Authorization');
  if (!authorization) return jsonResponse(401, { error: 'not_authenticated' });
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse(401, { error: 'not_authenticated' });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.slice(0, 200) : '';
  const description = typeof body.description === 'string' ? body.description.slice(0, MAX_TEXT) : '';
  const images = Array.isArray(body.images)
    ? body.images.filter((u): u is string => typeof u === 'string').slice(0, MAX_IMAGES)
    : [];
  try {
    const { verdict, reason } = await moderateContent(title, description, images);
    return jsonResponse(200, { verdict, reason });
  } catch {
    return jsonResponse(200, { verdict: 'ok', reason: null, degraded: true });
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
  try {
    const hook = req.headers.get('x-nexo-moderation-secret');
    if (hook) {
      if (hook !== env('MODERATION_WEBHOOK_SECRET')) return jsonResponse(403, { error: 'forbidden' });
      const body = await req.json().catch(() => ({})) as { plan_id?: unknown; score_texts?: unknown };
      // Calibración (solo con el secreto): puntuaciones y veredicto de varios textos.
      if (Array.isArray(body.score_texts)) {
        const texts = body.score_texts.filter((x): x is string => typeof x === 'string').slice(0, 40);
        const out = await Promise.all(texts.map(async (text) => {
          const r = await moderateContent(text, '', []);
          const top = Object.entries(r.scores).sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' ');
          return { text, verdict: r.verdict, top };
        }));
        return jsonResponse(200, { results: out });
      }
      const planId = typeof body.plan_id === 'string' ? body.plan_id : '';
      if (!UUID_RE.test(planId)) return jsonResponse(400, { error: 'invalid_plan' });
      return await handleWebhook(planId);
    }
    return await handleApp(req);
  } catch (e) {
    return jsonResponse(500, { error: String(e instanceof Error ? e.message : e).slice(0, 120) });
  }
});
