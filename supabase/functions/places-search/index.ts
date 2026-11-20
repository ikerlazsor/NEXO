import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/destructiveCleanup.ts';

/**
 * Buscador de sitios con Google Places API (New). La clave vive solo aquí.
 *
 * - autocomplete: sugerencias mientras escribes, sesgadas a donde está el plan.
 * - details: coordenadas del sitio elegido (solo campos Essentials: location y
 *   formattedAddress), cerrando la sesión para que las sugerencias no se cobren aparte.
 *
 * Coste: cuotas diarias en Google Cloud por debajo del nivel gratuito. Si Google
 * corta o falla, la app vuelve sola a Photon.
 */

const UUID_RE = /^[0-9a-f-]{16,64}$/i;
const LANGS = new Set(['es', 'en', 'fr', 'de', 'pt', 'it']);

function key(): string {
  const k = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!k) throw new Error('missing_key');
  return k;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

async function autocomplete(body: Record<string, unknown>): Promise<Response> {
  const input = typeof body.input === 'string' ? body.input.trim().slice(0, 120) : '';
  if (input.length < 2) return jsonResponse(200, { results: [] });
  const sessionToken = typeof body.sessionToken === 'string' && UUID_RE.test(body.sessionToken)
    ? body.sessionToken
    : undefined;
  const lang = typeof body.lang === 'string' && LANGS.has(body.lang) ? body.lang : 'es';
  const lat = num(body.lat);
  const lon = num(body.lon);

  const req: Record<string, unknown> = { input, languageCode: lang, regionCode: 'es' };
  if (sessionToken) req.sessionToken = sessionToken;
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    req.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 30000 } };
    req.origin = { latitude: lat, longitude: lon };
  }

  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key() },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return jsonResponse(502, { error: `google_${res.status}` });
  const json = await res.json() as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        distanceMeters?: number;
      };
    }>;
  };
  const results = (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .slice(0, 8)
    .map((p) => ({
      placeId: p.placeId!,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
      distanceMeters: typeof p.distanceMeters === 'number' ? p.distanceMeters : null,
    }));
  return jsonResponse(200, { results });
}

async function details(body: Record<string, unknown>): Promise<Response> {
  const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : '';
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return jsonResponse(400, { error: 'invalid_place' });
  const sessionToken = typeof body.sessionToken === 'string' && UUID_RE.test(body.sessionToken)
    ? body.sessionToken
    : '';
  const lang = typeof body.lang === 'string' && LANGS.has(body.lang) ? body.lang : 'es';
  const qs = new URLSearchParams({ languageCode: lang, regionCode: 'es' });
  if (sessionToken) qs.set('sessionToken', sessionToken);

  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?${qs}`, {
    headers: {
      'X-Goog-Api-Key': key(),
      // Solo campos Essentials: lo más barato (y dentro del gratuito).
      'X-Goog-FieldMask': 'location,formattedAddress',
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return jsonResponse(502, { error: `google_${res.status}` });
  const json = await res.json() as {
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
  };
  const latitude = num(json.location?.latitude);
  const longitude = num(json.location?.longitude);
  if (latitude === null || longitude === null) return jsonResponse(404, { error: 'no_location' });
  return jsonResponse(200, { latitude, longitude, address: json.formattedAddress ?? '' });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === 'autocomplete') return await autocomplete(body);
    if (body.action === 'details') return await details(body);
    return jsonResponse(400, { error: 'invalid_action' });
  } catch (e) {
    return jsonResponse(500, { error: String(e instanceof Error ? e.message : e).slice(0, 120) });
  }
});
