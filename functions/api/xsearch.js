// GET /api/xsearch?q=关键词&n=20  -> 搜索 X 上的视频推文
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

const XRE = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d{8,25})/g;

function collect(html, ids, seen) {
  let m;
  XRE.lastIndex = 0;
  while ((m = XRE.exec(html))) {
    if (!seen.has(m[2])) { seen.add(m[2]); ids.push(m[2]); }
  }
  // DDG/Bing 的跳转链接
  const re2 = /[?&](?:uddg|u)=([^&"]+)/g;
  while ((m = re2.exec(html))) {
    try {
      const real = decodeURIComponent(m[1]);
      const mm = real.match(/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d{8,25})/);
      if (mm && !seen.has(mm[1])) { seen.add(mm[1]); ids.push(mm[1]); }
    } catch (e) {}
  }
  return ids.length;
}

async function tryFetch(url, opts) {
  try {
    const r = await fetch(url, opts);
    const html = await r.text();
    return { status: r.status, html };
  } catch (e) {
    return { status: 0, html: '', err: String(e).slice(0, 80) };
  }
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const n = Math.min(40, parseInt(u.searchParams.get('n') || '20', 10));
  if (!q) return json({ ok: false, error: 'missing q' }, 400);

  const ids = [];
  const seen = new Set();
  const report = [];
  const query = 'site:x.com ' + q;

  // 1) DuckDuckGo (POST)
  {
    const r = await tryFetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://duckduckgo.com/',
      },
      body: new URLSearchParams({ q: query }).toString(),
    });
    const got = collect(r.html || '', ids, seen);
    report.push({ e: 'ddg', s: r.status, n: got });
  }

  // 2) DuckDuckGo Lite (GET)
  if (ids.length < n) {
    const r = await tryFetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const got = collect(r.html || '', ids, seen);
    report.push({ e: 'ddglite', s: r.status, n: got });
  }

  // 3) Bing
  if (ids.length < n) {
    const r = await tryFetch('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=30', {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const got = collect(r.html || '', ids, seen);
    report.push({ e: 'bing', s: r.status, n: got });
  }

  // 4) Yandex
  if (ids.length < n) {
    const r = await tryFetch('https://yandex.com/search/?text=' + encodeURIComponent(query), {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const got = collect(r.html || '', ids, seen);
    report.push({ e: 'yandex', s: r.status, n: got });
  }

  // 5) Mojeek
  if (ids.length < n) {
    const r = await tryFetch('https://www.mojeek.com/search?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const got = collect(r.html || '', ids, seen);
    report.push({ e: 'mojeek', s: r.status, n: got });
  }

  return json({
    ok: true, q, count: ids.length, ids: ids.slice(0, n),
    engines: report,
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
