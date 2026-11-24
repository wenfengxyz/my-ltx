// GET /api/img?u=<encoded url>&w=360&h=500  -> 服务端抓图并回传（仅白名单域名）
const ALLOW = [
  'c0.jdbstatic.com', 'c1.jdbstatic.com', 'c2.jdbstatic.com',
  'c3.jdbstatic.com', 'c4.jdbstatic.com', 'c5.jdbstatic.com',
  'cf.javfree.me', 'javfree.me', 'pics.dmm.co.jp',
  'pbs.twimg.com', 'video.twimg.com', 'abs.twimg.com',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

async function grab(url, extraHeaders) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://javdb.com/',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(extraHeaders || {}),
    },
    cf: { cacheEverything: true, cacheTtl: 604800 },
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const target = url.searchParams.get('u') || '';
  if (!target) return new Response('missing u', { status: 400 });

  let host;
  try {
    host = new URL(target).hostname.toLowerCase();
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (!ALLOW.includes(host)) return new Response('host not allowed', { status: 403 });

  const w = url.searchParams.get('w');
  const h = url.searchParams.get('h');

  // 有尺寸参数时先走图片 CDN 压缩（体积可降到 1/10），失败再直取原图
  const tries = [];
  if (w) {
    const q = new URLSearchParams({ w, output: 'webp', q: '80', url: target });
    if (h) q.set('h', h);
    if (h) q.set('fit', 'cover');
    tries.push('https://wsrv.nl/?' + q.toString());
  }
  tries.push(target);

  for (const u of tries) {
    try {
      const r = await grab(u);
      if (!r.ok) continue;
      const body = await r.arrayBuffer();
      const type = r.headers.get('content-type') || 'image/jpeg';
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=604800, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (e) {
      // try next
    }
  }
  return new Response('upstream failed', { status: 502 });
}
