// GET /api/fx?p=/2/status/ID  -> 服务端转发 fxtwitter（对方不开 CORS）
const ALLOW_HOST = 'api.fxtwitter.com';

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const p = u.searchParams.get('p') || '';
  if (!p.startsWith('/2/')) return json({ ok: false, error: 'bad path' }, 400);

  const target = 'https://' + ALLOW_HOST + p;
  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'XDownMobile/1.0',
        Accept: 'application/json',
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!r.ok) {
      return json({ ok: false, status: r.status }, 200);
    }
    const body = await r.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 100) }, 200);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
