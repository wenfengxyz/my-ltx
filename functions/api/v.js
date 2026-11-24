// GET /api/v?u=<视频地址>  -> 视频流代理（支持 Range，便于拖动进度条）
const ALLOW = ['video.twimg.com', 'pbs.twimg.com'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const target = u.searchParams.get('u') || '';
  if (!target) return new Response('missing u', { status: 400 });

  let host;
  try {
    host = new URL(target).hostname.toLowerCase();
  } catch (e) {
    return new Response('bad url', { status: 400 });
  }
  if (ALLOW.indexOf(host) < 0) return new Response('host not allowed', { status: 403 });

  const range = request.headers.get('Range') || '';
  const headers = {
    'User-Agent': UA,
    Referer: 'https://x.com/',
    Accept: '*/*',
  };
  if (range) headers['Range'] = range;

  try {
    const r = await fetch(target, { headers, cf: { cacheEverything: true, cacheTtl: 86400 } });
    if (!r.ok && r.status !== 206) {
      return new Response('upstream ' + r.status, { status: 502 });
    }
    const out = new Headers();
    out.set('Content-Type', r.headers.get('Content-Type') || 'video/mp4');
    out.set('Accept-Ranges', 'bytes');
    const len = r.headers.get('Content-Length');
    if (len) out.set('Content-Length', len);
    const cr = r.headers.get('Content-Range');
    if (cr) out.set('Content-Range', cr);
    out.set('Cache-Control', 'public, max-age=86400');
    out.set('Access-Control-Allow-Origin', '*');
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) {
    return new Response('fetch error: ' + String(e).slice(0, 80), { status: 502 });
  }
}
