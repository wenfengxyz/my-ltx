// GET /api/xtest2?q=关键词 -> 通过公共代理请求搜索引擎
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const XRE = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d{8,25})/g;
function count(html){let n=0,s=new Set(),m;XRE.lastIndex=0;while((m=XRE.exec(html))){if(!s.has(m[2])){s.add(m[2]);n++;}}return n;}
export async function onRequestGet({request}) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q')||'dance').trim();
  const target = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent('site:x.com ' + q);
  const enc = encodeURIComponent(target);
  const probs = [
    ['allorigins', 'https://api.allorigins.win/raw?url=' + enc],
    ['corsproxy', 'https://corsproxy.io/?' + enc],
    ['codetabs', 'https://api.codetabs.com/v1/proxy?quest=' + enc],
    ['jina', 'https://r.jina.ai/' + target],
    ['thingproxy', 'https://thingproxy.freeboard.io/fetch/' + target],
    ['proxy_cors_sh', 'https://proxy.cors.sh/' + target],
    ['isomorphic', 'https://cors.isomorphic-git.org/' + target],
  ];
  const out = [];
  await Promise.all(probs.map(async ([name, url]) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, {headers:{'User-Agent':UA,'Accept':'*/*'}, redirect:'follow'});
      const html = await r.text();
      out.push({name, status:r.status, len:html.length, hits:count(html), ms:Date.now()-t0, head:html.slice(0,60)});
    } catch(e) { out.push({name, status:0, err:String(e).slice(0,60)}); }
  }));
  out.sort((a,b)=>(b.hits||0)-(a.hits||0));
  return new Response(JSON.stringify({q, results: out}, null, 1),
    {headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
