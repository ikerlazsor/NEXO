/**
 * Worker mínimo: sirve la carpeta site/ y reescribe /plan/* → /plan/index.html.
 * También fuerza Content-Type JSON en el AASA (Apple Universal Links).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (
      path === '/.well-known/apple-app-site-association'
      || path === '/apple-app-site-association'
    ) {
      const assetReq = new Request(new URL('/.well-known/apple-app-site-association', url.origin), request);
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
      const assetReq = new Request(new URL('/plan/index.html', url.origin), request);
      return env.ASSETS.fetch(assetReq);
    }

    return env.ASSETS.fetch(request);
  },
};
