// GET /api/xtest?q=关键词  -> 探测各来源可用性（诊断用）
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

const XRE = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d{8,25})/g;

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || 'dance').trim();
  const enc = encodeURIComponent(q);

  const targets = [
    ['nitter.net', 'https://nitter.net/search?f=videos&q=' + enc],
    ['nitter.poast', 'https://nitter.poast.org/search?f=videos&q=' + enc],
    ['nitter.privacy', 'https://nitter.privacyredirect.com/search?f=videos&q=' + enc],
    ['nitter.tiekoetter', 'https://nitter.tiekoetter.com/search?f=videos&q=' + enc],
    ['lightbrd', 'https://lightbrd.com/search?f=videos&q=' + enc],
    ['sotwe', 'https://www.sotwe.com/search/' + enc],
    ['twstalker', 'https://twstalker.com/search?q=' + enc],
    ['xcancel', 'https://xcancel.com/search?f=videos&q=' + enc],
    ['searx.be', 'https://searx.be/search?q=' + encodeURIComponent('site:x.com ' + q)],
    ['priv.au', 'https://priv.au/search?q=' + encodeURIComponent('site:x.com ' + q)],
    ['search.inetol', 'https://search.inetol.net/search?q=' + encodeURIComponent('site:x.com ' + q)],
    ['brave', 'https://search.brave.com/search?q=' + encodeURIComponent('site:x.com ' + q)],
    ['startpage', 'https://www.startpage.com/sp/search?query=' + encodeURIComponent('site:x.com ' + q)],
    ['ecosia', 'https://www.ecosia.org/search?q=' + encodeURIComponent('site:x.com ' + q)],
  ];

  const out = [];
  await Promise.all(targets.map(async ([name, url]) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      const html = await r.text();
      let n = 0;
      const seen = new Set();
      let m;
      XRE.lastIndex = 0;
      while ((m = XRE.exec(html))) {
        if (!seen.has(m[2])) { seen.add(m[2]); n++; }
      }
      out.push({ name, status: r.status, len: html.length, hits: n, ms: Date.now() - t0 });
    } catch (e) {
      out.push({ name, status: 0, err: String(e).slice(0, 60), ms: Date.now() - t0 });
    }
  }));

  out.sort((a, b) => (b.hits || 0) - (a.hits || 0));
  return new Response(JSON.stringify({ q, results: out }, null, 1), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
