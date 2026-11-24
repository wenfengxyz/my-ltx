// GET /api/ts?u=<推文链接>  -> 通过 twittersaver 解析直链（无需电脑）
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const link = (u.searchParams.get('u') || '').trim();
  if (!link) return json({ ok: false, error: 'missing u' }, 400);
  if (!/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(link)) {
    return json({ ok: false, error: '不是推文链接' }, 400);
  }

  let html = '';
  try {
    const body = new URLSearchParams({ q: link }).toString();
    const r = await fetch('https://twittersaver.net/api/ajaxSearch', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://twittersaver.net/zh-cn',
        Origin: 'https://twittersaver.net',
      },
      body,
    });
    const txt = await r.text();
    let obj = null;
    try { obj = JSON.parse(txt); } catch (e) {}
    if (!obj) return json({ ok: false, error: '解析失败' }, 502);
    html = obj.data || '';
    if (!html) return json({ ok: false, error: obj.msg || '没拿到内容' }, 502);
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 100) }, 502);
  }

  // 缩略图
  const thumbs = [];
  const tre = /<img[^>]+src="([^"]+)"/g;
  let m;
  while ((m = tre.exec(html))) {
    if (m[1] && thumbs.indexOf(m[1]) < 0) thumbs.push(m[1]);
  }

  // 下载直链（dl.snapcdn.app 的 JWT 链接）
  const links = [];
  const lre = /href="([^"]+)"/g;
  while ((m = lre.exec(html))) {
    const h = m[1];
    if (!h || h === '#' || h.indexOf('/') === 0) continue;
    if (h.indexOf('dl.snapcdn.app') >= 0 || /\.(mp4|jpg|jpeg|png|webp)/i.test(h)) {
      if (links.indexOf(h) < 0) links.push(h.replace(/&amp;/g, '&'));
    }
  }

  // 从 JWT 里读原始地址判断类型
  const items = links.map((href) => {
    let kind = 'file';
    const tk = href.match(/token=([^&]+)/);
    if (tk) {
      try {
        const payload = tk[1].split('.')[1];
        const pad = payload + '==='.slice((payload.length + 3) % 4);
        const data = JSON.parse(atob(pad.replace(/-/g, '+').replace(/_/g, '/')));
        const src = data.url || '';
        if (/video|\.mp4/i.test(src)) kind = 'video';
        else if (/\.(jpg|jpeg|png|webp)/i.test(src)) kind = 'image';
        return { url: href, kind, src };
      } catch (e) {}
    }
    if (/\.mp4/i.test(href)) kind = 'video';
    return { url: href, kind };
  });

  const videos = items.filter((x) => x.kind === 'video');
  const images = items.filter((x) => x.kind === 'image');

  return json({
    ok: true,
    link,
    thumb: thumbs[0] || '',
    thumbs: thumbs.slice(0, 6),
    videos: videos.slice(0, 6),
    images: images.slice(0, 12),
    count: items.length,
  });
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
