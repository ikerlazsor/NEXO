/**
 * Imagen OG del plan: solo la portada (sin textos ni avatares).
 * WhatsApp no ejecuta la app: tiene que ser un JPEG público.
 * Deploy: npx supabase functions deploy share-card --project-ref nixeproyzxvqzyrvsxcx --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { COVER_URLS } from './covers.ts';
import satori from 'https://esm.sh/satori@0.10.14';
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';
import { encode as encodeJpeg } from 'https://esm.sh/jpeg-js@0.4.4';

const FONT_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-700-normal.ttf';
const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';

let wasmReady: Promise<void> | null = null;
let fontData: ArrayBuffer | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const res = await fetch(WASM_URL);
      if (!res.ok) throw new Error('wasm_fetch_failed');
      await initWasm(await res.arrayBuffer());
    })();
  }
  return wasmReady;
}

async function font(): Promise<ArrayBuffer> {
  if (!fontData) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error('font_fetch_failed');
    fontData = await res.arrayBuffer();
  }
  return fontData;
}

function extractPlanId(req: Request): string | null {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'share-card');
  const raw = idx >= 0 ? parts[idx + 1] : url.searchParams.get('id');
  const id = (raw || '').split('?')[0].trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function resolveImageUrl(raw: string | null | undefined, supabaseUrl: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^nexo_cover:/i.test(v)) return COVER_URLS[v] ?? null;
  if (/^https?:\/\//i.test(v)) return v.split('?')[0];
  if (/^[a-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(v) || v.includes('/')) {
    return `${supabaseUrl}/storage/v1/object/public/imagenes-planes/${v.replace(/^\/+/, '')}`;
  }
  return null;
}

function jpeg(bytes: Uint8Array): Response {
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

async function passthrough(url: string | null): Promise<Response | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/jpeg';
    return new Response(bytes, {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return null;
  }
}

const BRAND_OG =
  'https://nixeproyzxvqzyrvsxcx.supabase.co/storage/v1/object/public/imagenes-planes/nexo-og-default.png';

/** Solo la portada del plan, recortada a 1200×630 (sin título, burbujas ni textos). */
Deno.serve(async (req) => {
  const planId = extractPlanId(req);
  if (!planId) return new Response('not found', { status: 404 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return new Response('misconfigured', { status: 500 });

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: plan } = await sb
    .from('planes')
    .select('imagen_url')
    .eq('id', planId)
    .maybeSingle();

  const cover = resolveImageUrl(plan?.imagen_url as string | null, supabaseUrl);
  if (!cover) {
    return (await passthrough(BRAND_OG)) ?? new Response('unavailable', { status: 404 });
  }

  try {
    await ensureWasm();
    const fontBytes = await font();
    // Recorte a 1200×630 y JPEG ligero: WhatsApp descarta imágenes muy pesadas.
    const svg = await satori(
      {
        type: 'img',
        props: {
          src: cover,
          width: 1200,
          height: 630,
          style: { width: 1200, height: 630, objectFit: 'cover' },
        },
      } as never,
      {
        width: 1200,
        height: 630,
        fonts: [{ name: 'Inter', data: fontBytes, weight: 700, style: 'normal' }],
      },
    );
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render();
    const jpg = encodeJpeg(
      { data: rendered.pixels, width: rendered.width, height: rendered.height },
      72,
    );
    rendered.free();
    return new Response(jpg.data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('share-card cover', error);
    const fallback = await passthrough(cover);
    if (fallback) return fallback;
    return new Response('unavailable', { status: 404 });
  }
});
