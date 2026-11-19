/**
 * Worker: sirve este directorio, Universal Links AASA, /plan/* y redirects legacy.
 */
const REDIRECTS = {
  '/privacy-policy': '/privacidad',
  '/privacy-policy.html': '/privacidad',
  '/privacy-policy.en.html': '/privacy',
  '/account-deletion': '/eliminar-cuenta',
  '/account-deletion.html': '/eliminar-cuenta',
  '/terms': '/terminos',
  '/community-norms': '/normas',
  '/support': '/soporte',
  '/contacto': '/soporte',
};

const APP_PATHS = new Set(['/app', '/descargar', '/download']);
const APP_STORE_URL = 'https://apps.apple.com/es/app/id6804630497';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ikerlazsor.nexo';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    const dest = REDIRECTS[path] || REDIRECTS[url.pathname];
    if (dest) {
      return Response.redirect(new URL(dest, url.origin).toString(), 301);
    }

    // Enlace único de descarga (bio de Instagram/TikTok, historias…): lleva a la tienda
    // según el móvil. ?src=ig|tt|… llega a Google Play como utm_source para medir el origen.
    if (APP_PATHS.has(path)) {
      const ua = request.headers.get('user-agent') || '';
      const src = (url.searchParams.get('src') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
      let target;
      if (/iPhone|iPad|iPod/i.test(ua)) {
        target = APP_STORE_URL;
      } else if (/Android/i.test(ua)) {
        const referrer = `utm_source=${src || 'link'}&utm_medium=social&utm_campaign=app_link`;
        target = `${PLAY_STORE_URL}&referrer=${encodeURIComponent(referrer)}`;
      } else {
        target = new URL('/', url.origin).toString();
      }
      return new Response(null, {
        status: 302,
        headers: { Location: target, 'Cache-Control': 'no-store', Vary: 'User-Agent' },
      });
    }

    if (
      path === '/.well-known/apple-app-site-association'
      || path === '/apple-app-site-association'
    ) {
      const assetReq = new Request(
        new URL('/.well-known/apple-app-site-association', url.origin),
        request,
      );
      const res = await env.ASSETS.fetch(assetReq);
      if (!res.ok) return res;
      const body = await res.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=0, must-revalidate',
        },
      });
    }

    if (path === '/plan' || path.startsWith('/plan/')) {
      const id = path.split('/')[2] || '';
      const ua = request.headers.get('user-agent') || '';
      const isPreviewBot = /whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|embedly|pinterest|googlebot|bingpreview|applebot|previewbot/i
        .test(ua);
      if (/^[0-9a-f-]{36}$/i.test(id) && isPreviewBot) {
        // Se reenvía la query: `evento=1` y `c` (portada del evento) llegan a la vista previa.
        const cardPage = `https://nixeproyzxvqzyrvsxcx.supabase.co/functions/v1/share-plan/${id}${url.search}`;
        const upstream = await fetch(cardPage, { headers: { 'user-agent': ua, 'accept-language': request.headers.get('accept-language') || 'es' } });
        const html = await upstream.text();
        return new Response(html, {
          status: upstream.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=0, must-revalidate',
          },
        });
      }
      const assetReq = new Request(new URL('/plan/index.html', url.origin), request);
      return env.ASSETS.fetch(assetReq);
    }

    return env.ASSETS.fetch(request);
  },
};
