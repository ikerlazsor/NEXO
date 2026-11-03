/**
 * Landing share-plan.
 * - Con app: intenta nexo:// / intent:// y abre el plan
 * - Sin app: tras ~1.4s → App Store / Play Store
 *
 * Deploy: npx supabase functions deploy share-plan --project-ref nixeproyzxvqzyrvsxcx --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const ANDROID_PACKAGE = 'com.ikerlazsor.nexo';
/** App Store Connect ascAppId (eas.json) */
const APP_STORE_URL = 'https://apps.apple.com/app/id6804630497';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
const BRAND_OG =
  'https://nixeproyzxvqzyrvsxcx.supabase.co/storage/v1/object/public/imagenes-planes/nexo-og-default.png';

type PlanRow = {
  id: string;
  titulo: string;
  imagen_url: string | null;
  nombre_ubicacion: string | null;
  fecha_evento: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveImageUrl(raw: string | null | undefined, supabaseUrl: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^nexo_cover:/i.test(v)) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(v) || v.includes('/')) {
    return `${supabaseUrl}/storage/v1/object/public/imagenes-planes/${v.replace(/^\/+/, '')}`;
  }
  return null;
}

function formatWhen(iso: string | null | undefined, lang: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tag =
    lang === 'en' ? 'en-GB'
    : lang === 'fr' ? 'fr-FR'
    : lang === 'de' ? 'de-DE'
    : lang === 'pt' ? 'pt-PT'
    : lang === 'it' ? 'it-IT'
    : 'es-ES';
  try {
    return new Intl.DateTimeFormat(tag, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Madrid',
    }).format(d);
  } catch {
    return '';
  }
}

function detectShareLang(acceptLanguage: string): string {
  const raw = acceptLanguage.toLowerCase();
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('fr')) return 'fr';
  if (raw.startsWith('de')) return 'de';
  if (raw.startsWith('pt')) return 'pt';
  if (raw.startsWith('it')) return 'it';
  if (raw.startsWith('es')) return 'es';
  return 'en';
}


function extractPlanId(req: Request): string | null {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'share-plan');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].split('?')[0];
  return (url.searchParams.get('id') || url.searchParams.get('planId') || '').trim() || null;
}

function isLinkPreviewBot(ua: string): boolean {
  if (/whatsapp/i.test(ua) && !/chrome|crios|safari|firefox|mobile|android|iphone/i.test(ua)) {
    return true;
  }
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|bingpreview|googlebot|embedly|pinterest|applebot|previewbot|crawler|spider/i
    .test(ua);
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(new TextEncoder().encode(html), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
    },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const planId = extractPlanId(req);
  if (!planId || !/^[0-9a-f-]{36}$/i.test(planId)) {
    return htmlResponse(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title></head><body>Not found</body></html>',
      404,
    );
  }

  const ua = req.headers.get('user-agent') || '';
  const lang = detectShareLang(req.headers.get('accept-language') || '');
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);

  let plan: PlanRow | null = null;
  if (supabaseUrl && serviceKey) {
    try {
      const sb = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await sb
        .from('planes')
        .select('id, titulo, imagen_url, nombre_ubicacion, fecha_evento')
        .eq('id', planId)
        .maybeSingle();
      plan = (data as PlanRow | null) ?? null;
    } catch {
      plan = null;
    }
  }

  const title = (plan?.titulo || 'Nexo!').trim().slice(0, 120);
  const when = formatWhen(plan?.fecha_evento, lang);
  const location = (plan?.nombre_ubicacion || '').trim();
  let going = 0;
  if (plan && supabaseUrl && serviceKey) {
    try {
      const sb = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { count } = await sb
        .from('participantes')
        .select('usuario_id', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');
      going = count ?? 0;
    } catch {
      going = 0;
    }
  }
  const cardImage = `${supabaseUrl}/functions/v1/share-card/${planId}?v=8`;
  const image = cardImage || resolveImageUrl(plan?.imagen_url, supabaseUrl) || BRAND_OG;
  const deepLink = `nexo://plan/${planId}`;
  const storeUrl = isIOS ? APP_STORE_URL : isAndroid ? PLAY_STORE_URL : APP_STORE_URL;
  const intent =
    `intent://plan/${planId}#Intent;scheme=nexo;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
  const primary = isIOS ? deepLink : intent;
  const pageUrl = `${supabaseUrl}/functions/v1/share-plan/${planId}`;
  const shareUi = {
    es: {
      open: 'Abrir en Nexo!',
      store: 'Descargar Nexo! en App Store',
      storeAndroid: 'Descargar Nexo! en Google Play',
      hint: 'Si no tienes la app, descárgala abajo',
      desc: 'Abre este plan en Nexo!',
    },
    en: {
      open: 'Open in Nexo!',
      store: 'Get Nexo! on the App Store',
      storeAndroid: 'Get Nexo! on Google Play',
      hint: 'If the app does not open, download it below',
      desc: 'Open this plan in Nexo!',
    },
    fr: {
      open: 'Ouvrir dans Nexo!',
      store: 'Télécharger Nexo! sur l’App Store',
      storeAndroid: 'Télécharger Nexo! sur Google Play',
      hint: 'Si l’app ne s’ouvre pas, télécharge-la ci-dessous',
      desc: 'Ouvre ce plan dans Nexo!',
    },
    de: {
      open: 'In Nexo! öffnen',
      store: 'Nexo! im App Store laden',
      storeAndroid: 'Nexo! bei Google Play laden',
      hint: 'Wenn die App nicht öffnet, lade sie unten herunter',
      desc: 'Diesen Plan in Nexo! öffnen',
    },
    pt: {
      open: 'Abrir no Nexo!',
      store: 'Descarregar Nexo! na App Store',
      storeAndroid: 'Descarregar Nexo! no Google Play',
      hint: 'Se a app não abrir, descarrega-a abaixo',
      desc: 'Abre este plano no Nexo!',
    },
    it: {
      open: 'Apri in Nexo!',
      store: 'Scarica Nexo! sull’App Store',
      storeAndroid: 'Scarica Nexo! su Google Play',
      hint: 'Se l’app non si apre, scaricala qui sotto',
      desc: 'Apri questo piano in Nexo!',
    },
  }[lang] || {
    open: 'Open in Nexo!',
    store: 'Get Nexo! on the App Store',
    storeAndroid: 'Get Nexo! on Google Play',
    hint: 'If the app does not open, download it below',
    desc: 'Open this plan in Nexo!',
  };

  const goingLine = going > 0 ? `¡Ya somos ${going}!` : '';
  const description = [goingLine, when, location].filter(Boolean).join(' · ') || shareUi.desc;
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safePage = escapeHtml(pageUrl);
  const safePrimary = escapeHtml(primary);
  const safeStore = escapeHtml(storeUrl);
  const safePlay = escapeHtml(PLAY_STORE_URL);
  const safeAppStore = escapeHtml(APP_STORE_URL);

  if (isLinkPreviewBot(ua)) {
    return htmlResponse(`<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${safeTitle} · Nexo!</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Nexo!"/>
<meta property="og:title" content="${safeTitle}"/>
<meta property="og:description" content="${safeDesc}"/>
<meta property="og:url" content="${safePage}"/>
<meta property="og:image" content="${safeImage}"/>
<meta property="og:image:secure_url" content="${safeImage}"/>
<meta property="og:image:type" content="image/jpeg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
</head><body><p>${safeTitle}</p></body></html>`);
  }

  const openLabel = shareUi.open;
  const storeLabel = shareUi.store;
  const storeLabelAndroid = shareUi.storeAndroid;
  const hint = shareUi.hint;

  return htmlResponse(`<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="robots" content="noindex"/>
<title>${safeTitle}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Nexo!"/>
<meta property="og:title" content="${safeTitle}"/>
<meta property="og:description" content="${safeDesc}"/>
<meta property="og:url" content="${safePage}"/>
<meta property="og:image" content="${safeImage}"/>
<meta property="og:image:secure_url" content="${safeImage}"/>
<meta property="og:image:type" content="image/jpeg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<style>
html,body{margin:0;height:100%;background:#0B1220;color:#fff;font-family:system-ui,-apple-system,sans-serif}
main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;
background:linear-gradient(180deg,rgba(11,18,32,.45),#0B1220),url("${safeImage}") center/cover no-repeat}
.card{width:100%;max-width:400px;background:rgba(15,23,42,.92);border-radius:20px;padding:22px 18px;text-align:center}
.brand{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#93C5FD;margin-bottom:8px}
h1{margin:0 0 8px;font-size:22px;line-height:1.25}
p{margin:0 0 18px;color:#CBD5E1;font-size:14px;font-weight:600}
a.btn{display:block;background:#2563EB;color:#fff;text-decoration:none;font-weight:800;font-size:17px;padding:16px;border-radius:14px;margin-bottom:10px}
a.btn2{display:block;background:transparent;color:#93C5FD;text-decoration:none;font-weight:700;font-size:14px;padding:12px;border-radius:14px;border:1px solid rgba(147,197,253,.35)}
.hint{margin-top:12px;font-size:12px;color:#94A3B8}
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="brand">Nexo!</div>
    <h1>${safeTitle}</h1>
    <p>${safeDesc}</p>
    <a class="btn" id="open" href="${safePrimary}">${openLabel}</a>
    <a class="btn2" id="store" href="${safeStore}">${isAndroid ? storeLabelAndroid : storeLabel}</a>
    <p class="hint">${hint}</p>
  </div>
</main>
<script>
(function(){
  var primary=${JSON.stringify(primary)};
  var deep=${JSON.stringify(deepLink)};
  var store=${JSON.stringify(storeUrl)};
  var play=${JSON.stringify(PLAY_STORE_URL)};
  var appStore=${JSON.stringify(APP_STORE_URL)};
  var isIOS=${isIOS ? 'true' : 'false'};
  var isAndroid=${isAndroid ? 'true' : 'false'};
  var left = false;
  function go(u){ try{ window.location.href = u; }catch(e){} }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) left = true;
  });
  window.addEventListener('pagehide', function(){ left = true; });
  // Un solo intento de abrir la app (evitar 2× detalle por primary + deep)
  go(primary);
  setTimeout(function(){
    if (left) return;
    go(isIOS ? appStore : (isAndroid ? play : store));
  }, 1400);
})();
</script>
</body>
</html>`);
});
