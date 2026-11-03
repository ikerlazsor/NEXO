/**
 * Imagen OG del plan: portada, título, burbujas y «Ya somos N».
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
    .select('titulo, imagen_url')
    .eq('id', planId)
    .maybeSingle();

  const cover = resolveImageUrl(plan?.imagen_url as string | null, supabaseUrl);
  const title = String(plan?.titulo || 'Nexo!').trim().slice(0, 80);

  const { count } = await sb
    .from('participantes')
    .select('usuario_id', { count: 'exact', head: true })
    .eq('plan_id', planId)
    .eq('estado', 'aceptado');

  const { data: members } = await sb
    .from('participantes')
    .select('usuario_id')
    .eq('plan_id', planId)
    .eq('estado', 'aceptado')
    .limit(6);

  const ids = (members ?? []).map((row) => row.usuario_id as string).filter(Boolean);
  const total = count ?? ids.length;
  let avatars: string[] = [];
  if (ids.length) {
    const { data: profiles } = await sb
      .from('perfiles')
      .select('id, avatar_url')
      .in('id', ids);
    const byId = new Map((profiles ?? []).map((row) => [row.id as string, row.avatar_url as string | null]));
    avatars = ids
      .map((id) => byId.get(id) || '')
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//i.test(url))
      .slice(0, 5);
  }
  const extra = Math.max(0, total - avatars.length);

  try {
    await ensureWasm();
    const fontBytes = await font();
    const bubble = 124;
    const bubbles = avatars.map((src, index) => ({
      type: 'img',
      props: {
        src,
        width: bubble,
        height: bubble,
        style: {
          width: bubble,
          height: bubble,
          borderRadius: bubble / 2,
          border: '6px solid #ffffff',
          marginLeft: index === 0 ? 0 : -34,
          objectFit: 'cover',
        },
      },
    }));
    if (extra > 0) {
      bubbles.push({
        type: 'div',
        props: {
          style: {
            width: bubble,
            height: bubble,
            borderRadius: bubble / 2,
            marginLeft: avatars.length ? -34 : 0,
            background: '#2563EB',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44,
            border: '6px solid #ffffff',
          },
          children: `+${extra}`,
        },
      } as never);
    }

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: 1200,
            height: 630,
            display: 'flex',
            flexDirection: 'column',
            background: '#0F2A4A',
            fontFamily: 'Inter',
          },
          children: [
            {
              type: 'div',
              props: {
                style: { display: 'flex', width: 1200, height: 420, position: 'relative' },
                children: [
                  cover
                    ? {
                      type: 'img',
                      props: {
                        src: cover,
                        width: 1200,
                        height: 420,
                        style: { width: 1200, height: 420, objectFit: 'cover' },
                      },
                    }
                    : {
                      type: 'div',
                      props: { style: { width: 1200, height: 420, background: '#2563EB' } },
                    },
                  {
                    type: 'div',
                    props: {
                      style: {
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 220,
                        background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.72))',
                      },
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        position: 'absolute',
                        left: 36,
                        right: 36,
                        bottom: 28,
                        display: 'flex',
                        color: '#fff',
                        fontSize: 78,
                        fontWeight: 700,
                        lineHeight: 1.15,
                      },
                      children: title,
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  padding: '32px 40px',
                  background: '#ffffff',
                  height: 210,
                },
                children: [
                  { type: 'div', props: { style: { display: 'flex', alignItems: 'center' }, children: bubbles } },
                  {
                    type: 'div',
                    props: {
                      style: {
                        marginLeft: 28,
                        color: '#0F2A4A',
                        fontSize: 58,
                        fontWeight: 700,
                      },
                      children: total > 0 ? `¡Ya somos ${total}!` : 'Nexo!',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        width: 1200,
        height: 630,
        fonts: [{ name: 'Inter', data: fontBytes, weight: 700, style: 'normal' }],
      },
    );

    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render();
    const jpg = encodeJpeg(
      { data: rendered.pixels, width: rendered.width, height: rendered.height },
      62,
    );
    rendered.free();
    return new Response(jpg.data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('share-card compose', error);
    const fallback = await passthrough(cover);
    if (fallback) return fallback;
    return new Response('unavailable', { status: 404 });
  }
});
