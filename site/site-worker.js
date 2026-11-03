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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    const dest = REDIRECTS[path] || REDIRECTS[url.pathname];
    if (dest) {
      return Response.redirect(new URL(dest, url.origin).toString(), 301);
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
        const cardPage = `https://nixeproyzxvqzyrvsxcx.supabase.co/functions/v1/share-plan/${id}`;
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
