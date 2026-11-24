/**
 * Jasna-LTX API —— Cloudflare Pages Functions（同域 /api/*）
 * 数据存 KV 绑定 LTX_KV
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

function err(reason, status = 400, extra) {
  return json(Object.assign({ ok: false, reason }, extra || {}), status);
}

async function readJSON(request) {
  try {
    return await request.json();
  } catch (e) {
    return {};
  }
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 2000);
}

async function listKeys(KV, prefix) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const page = await KV.list(cursor ? { prefix, cursor } : { prefix });
    for (const k of page.keys) out.push(k.name);
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return out;
}

async function listItems(KV, prefix) {
  const keys = await listKeys(KV, prefix);
  const items = [];
  for (const k of keys) {
    const v = await KV.get(k, 'json');
    if (v) items.push(v);
  }
  return items;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const KV = env && env.LTX_KV;
  if (!KV) return err('kv binding missing', 500);

  try {
    if (path === '/api/status' && method === 'GET') {
      const c = await listKeys(KV, 'comment:');
      const s = await listKeys(KV, 'submission:');
      const f = await listKeys(KV, 'feedback:');
      return json({
        ok: true,
        status: 'ok',
        data: {
          comments: c.length,
          submissions: s.length,
          feedback: f.length,
          updated_at: new Date().toISOString(),
          backend: 'pages-functions',
        },
      });
    }

    if (path === '/api/comments' && method === 'GET') {
      const code = str(url.searchParams.get('code') || url.searchParams.get('movie')
      || url.searchParams.get('id') || '', 64).toUpperCase();
      const client = str(url.searchParams.get('client'), 128);
      if (!code) return err('missing code');
      const items = await listItems(KV, 'comment:' + code + ':');
      items.sort((a, b) => Number(a.id) - Number(b.id));
      const out = items.map((v) => {
        const liked = Array.isArray(v.liked) ? v.liked : [];
        return Object.assign({}, v, {
          likes: liked.length,
          liked: client ? liked.indexOf(client) !== -1 : false,
          mine: client ? v.client === client : false,
        });
      });
      return json({ ok: true, data: { items: out } });
    }

    if (path === '/api/comments' && method === 'POST') {
      const b = await readJSON(request);
      const code = str(b.code || b.movie || b.id || '', 64).toUpperCase();
      const body = str(b.body, 1000);
      const client = str(b.client, 128) || 'anon';
      if (!code || !body) return err('missing code or body');

      const cdKey = 'cooldown:' + client;
      const last = await KV.get(cdKey);
      if (last) {
        const left = 60000 - (Date.now() - Number(last));
        if (left > 0) {
          const sec = Math.ceil(left / 1000);
          return err('cooldown', 429, { retryAfter: sec, retry_after: sec });
        }
      }

      const id = Date.now();
      const item = {
        id, code, body, client,
        likes: 0, liked: [],
        created_at: new Date().toISOString(),
        hp: str(b.hp, 200),
      };
      await KV.put('comment:' + code + ':' + id, JSON.stringify(item));
      await KV.put('idx:comment:' + id, 'comment:' + code + ':' + id);
      await KV.put(cdKey, String(Date.now()), { expirationTtl: 120 });
      return json({ ok: true, data: { item: Object.assign({}, item, { liked: false, mine: true }) } });
    }

    if (path === '/api/comments/like' && method === 'POST') {
      const b = await readJSON(request);
      const id = str(b.id, 40);
      const client = str(b.client, 128) || 'anon';
      if (!id) return err('missing id');
      const fullKey = await KV.get('idx:comment:' + id);
      if (!fullKey) return err('gone', 404);
      const item = await KV.get(fullKey, 'json');
      if (!item) return err('gone', 404);
      const liked = Array.isArray(item.liked) ? item.liked.slice() : [];
      const i = liked.indexOf(client);
      if (!!b.like && i === -1) liked.push(client);
      if (!b.like && i !== -1) liked.splice(i, 1);
      item.liked = liked;
      item.likes = liked.length;
      await KV.put(fullKey, JSON.stringify(item));
      return json({ ok: true, data: { id: item.id, likes: item.likes, liked: liked.indexOf(client) !== -1 } });
    }

    if (path === '/api/comments/delete' && method === 'POST') {
      const b = await readJSON(request);
      const id = str(b.id, 40);
      const client = str(b.client, 128);
      if (!id) return err('missing id');
      if (!client) return err('missing client', 401);
      const idxKey = 'idx:comment:' + id;
      const fullKey = await KV.get(idxKey);
      if (!fullKey) return err('gone', 404);
      const item = await KV.get(fullKey, 'json');
      if (!item) return err('gone', 404);
      if (item.client !== client) return err('forbidden', 401);
      await KV.delete(fullKey);
      await KV.delete(idxKey);
      return json({ ok: true, data: { deleted: true, id: item.id } });
    }

    if (path === '/api/submissions' && method === 'GET') {
      const items = await listItems(KV, 'submission:');
      items.sort((a, b) => Number(a.id) - Number(b.id));
      return json({ ok: true, data: { items } });
    }

    if (path === '/api/submissions' && method === 'POST') {
      const b = await readJSON(request);
      let list = [];
      if (Array.isArray(b)) list = b;
      else if (Array.isArray(b.items)) list = b.items;
      else if (Array.isArray(b.list)) list = b.list;
      else list = [b];
      const client = str(b.client, 128) || 'anon';
      const ids = [];
      for (const raw of list.slice(0, 20)) {
        const code = str(raw && (raw.code || raw.value), 64).toUpperCase();
        if (!code) continue;
        const id = Date.now() + ids.length;
        const item = {
          id, code,
          title: str(raw && raw.title, 300),
          link: str(raw && raw.link, 1000),
          note: str(raw && raw.note, 500),
          client,
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        await KV.put('submission:' + id, JSON.stringify(item));
        ids.push(id);
      }
      if (!ids.length) return err('missing code');
      return json({ ok: true, data: { ids } });
    }

    if (path === '/api/submissions/block' && method === 'POST') {
      const b = await readJSON(request);
      const voter = str(b.voter || b.client, 128);
      if (!voter) return err('missing voter');
      const blocked = b.blocked === undefined ? true : !!b.blocked;
      if (blocked) await KV.put('block:' + voter, '1', { expirationTtl: 2592000 });
      else await KV.delete('block:' + voter);
      return json({ ok: true, data: { voter, blocked } });
    }

    if (path === '/api/feedback' && method === 'GET') {
      const items = await listItems(KV, 'feedback:');
      items.sort((a, b) => Number(a.id) - Number(b.id));
      return json({ ok: true, data: { items } });
    }

    if (path === '/api/feedback' && method === 'POST') {
      const b = await readJSON(request);
      const body = str(b.body || b.message || b.content, 2000);
      const client = str(b.client, 128) || 'anon';
      if (!body) return err('missing body');
      const id = Date.now();
      const item = {
        id,
        kind: str(b.kind || b.type, 40) || 'feedback',
        body,
        contact: str(b.contact, 200),
        client,
        status: 'new',
        created_at: new Date().toISOString(),
      };
      await KV.put('feedback:' + id, JSON.stringify(item));
      return json({ ok: true, data: { item } });
    }

    if (path === '/api/feedback/review' && method === 'POST') {
      const b = await readJSON(request);
      const actions = Array.isArray(b.actions) ? b.actions : [];
      const done = [];
      for (const a of actions.slice(0, 50)) {
        const id = str(a && (a.id || a.key), 40);
        if (!id) continue;
        const key = 'feedback:' + id;
        const item = await KV.get(key, 'json');
        if (!item) { done.push({ id, status: 'gone' }); continue; }
        const action = str(a.action, 20) || 'keep';
        if (action === 'delete') {
          await KV.delete(key);
          done.push({ id, status: 'deleted' });
        } else {
          item.status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reviewed';
          item.reviewed_at = new Date().toISOString();
          await KV.put(key, JSON.stringify(item));
          done.push({ id, status: item.status });
        }
      }
      return json({ ok: true, data: { reviewed: done.length, results: done } });
    }

    if (path === '/api/verify' && method === 'POST') {
      return json({ ok: true, data: { items: [{ success: true }] } });
    }

    if (path === '/api/evidence' && method === 'GET') {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Response(arr, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...CORS },
      });
    }

    if (path === '/api/export' && method === 'GET') {
      const c = await listKeys(KV, 'comment:');
      return json({ ok: true, data: { comments: c.length } });
    }

    if (path.indexOf('/api/v2/') === 0) {
      if (path === '/api/v2/app/version') return json({ ok: true, version: 'v4.6.0' });
      return json({ ok: true, data: {} });
    }

    return err('not found', 404);
  } catch (e) {
    return err('server error: ' + (e && e.message ? e.message : 'unknown'), 500);
  }
}
