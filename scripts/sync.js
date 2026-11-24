#!/usr/bin/env node
/**
 * Jasna-LTX 自动同步引擎
 * 从 sukebei.nyaa.si (Nyaa 成人区) 的 LTX 种子 RSS/搜索页拉取最新资源，
 * 与 data/movies.json 现有条目比对，增量追加新条目，更新统计字段。
 *
 * 用法：
 *   node scripts/sync.js              # 正常同步（有新数据才写文件）
 *   node scripts/sync.js --dry-run    # 只检查不写入
 *
 * 环境变量（可选）：
 *   NYAA_BASE       源站地址，默认 https://sukebei.nyaa.si
 *   NYAA_QUERY      搜索关键词，默认 LTX
 *   MAX_ITEMS       单次最多处理多少条，默认 100
 *   CF_PAGES_TOKEN  Cloudflare API Token（有此变量时同步后自动触发 Pages 重新部署）
 *   CF_ACCOUNT_ID   Cloudflare Account ID
 *   CF_PROJECT      Pages 项目名，默认 jasna-ltx
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'nyaa-incoming.json');

const NYAA_BASE = process.env.NYAA_BASE || 'https://sukebei.nyaa.si';
const NYAA_QUERY = process.env.NYAA_QUERY || 'LTX';
const MAX_ITEMS = parseInt(process.env.MAX_ITEMS || '100', 10);
const DRY_RUN = process.argv.includes('--dry-run');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function log(...a) { console.log('[sync]', ...a); }

/** 简易 fetch 封装（Node 18+ 内置 fetch） */
async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/html,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 解码 XML 实体 */
function xmlDecode(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 解析 RSS item */
function parseRss(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? xmlDecode(m[1]).trim() : '';
    };
    const title = pick('title');
    const link = pick('link');
    const guid = pick('guid');
    const date = pick('pubDate');
    let size = pick('nyaa:size') || pick('size');
    if (!size) {
      const sm = b.match(/size[^\d]*(\d+(?:\.\d+)?)\s*(GiB|MiB|KiB|B)/i);
      if (sm) size = sm[1] + ' ' + sm[2];
    }
    if (title && link) items.push({ title, link, guid, date, size });
  }
  return items;
}

/** 把 RSS 条目转换成 movies.json 的 item 结构 */
function toMovie(rssItem) {
  const title = rssItem.title;
  // 从标题提取番号：形如 [LTX] ABC-123 或 www.98T.la@ABC-123_LTX
  let code = '';
  const cm = title.match(/\b([A-Z]{2,6}[-_]?\d{2,5})\b/i);
  if (cm) code = cm[1].replace('_', '-').toUpperCase();
  // 生成 ed2k/magnet 链接（RSS link 通常是详情页，实际种子需访问 page）
  const link = rssItem.link;
  const linkType = link.startsWith('magnet:') ? 'magnet' : 'ed2k';
  return {
    actors: [],
    added_at: Date.now(),
    code: code || title.slice(0, 20),
    comments: 0,
    cover: '',
    date: rssItem.date ? new Date(rssItem.date).toISOString().slice(0, 10) : '',
    director: '',
    genres: [],
    likers: 0,
    link: link,
    linkPending: linkType !== 'ed2k',
    linkType: linkType,
    score: 0,
    title: title,
    _source: 'nyaa:auto',
  };
}

/** 从 link 提取稳定去重 key */
function dedupKey(item) {
  if (item.code) return 'code:' + item.code.toUpperCase();
  return 'link:' + (item.link || item.title || '');
}

async function main() {
  log('开始同步，源：', NYAA_BASE, '关键词：', NYAA_QUERY);

  // 读现有数据
  let data;
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch (e) { data = { items: [], updated_at: null, nyaa: {}, actors: [], genres: [] }; }
  if (!Array.isArray(data.items)) data.items = [];

  // 现有 key 集合
  const existing = new Set(data.items.map(dedupKey));
  log('现有条目：', data.items.length);

  // 拉 RSS（尝试多个 URL 格式）
  const bases = String(NYAA_BASE || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!bases.includes('https://nyaa.si')) bases.push('https://nyaa.si');
  const urls = [];
  for (const b of bases) {
    urls.push(`${b}/?page=rss&q=${encodeURIComponent(NYAA_QUERY + ' LTX')}&c=2_2&f=0`);
    urls.push(`${b}/?page=rss&q=${encodeURIComponent(NYAA_QUERY)}`);
  }
  let xml = '';
  for (const u of urls) {
    try {
      xml = await fetchText(u);
      if (xml.includes('<item>')) { log('RSS 获取成功：', u); break; }
    } catch (e) { log('RSS 失败：', u, '-', e.message); }
  }
  if (!xml) {
    const msg = '所有 RSS 源均不可用（站点屏蔽或临时宕机）';
    try {
      data.nyaa = Object.assign({}, data.nyaa || {}, {
        checked_at: Date.now(),
        ok: false,
        error: msg,
        checked_sources: urls.length,
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
      log('已写入失败状态到数据文件，前端可显示最近检查时间/结果');
    } catch (e2) { log('写入失败状态出错：', e2.message); }
    throw new Error(msg);
  }

  const rssItems = parseRss(xml).slice(0, MAX_ITEMS);
  log('RSS 条目：', rssItems.length);

  // 增量追加
  let added = 0;
  const seen = new Set();
  for (const ri of rssItems) {
    const movie = toMovie(ri);
    const key = dedupKey(movie);
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    data.items.unshift(movie);
    added++;
  }

  log('新增：', added, '条');

  if (added === 0) { log('无新增，跳过写入'); return; }

  // 更新统计字段
  data.updated_at = new Date().toISOString();
  data.nyaa = Object.assign({}, data.nyaa || {}, {
    checked_at: Date.now(), ok: true, error: null,
  });
  if (data.nyaa && typeof data.nyaa === 'object') {
    data.nyaa.added = (data.nyaa.added || 0) + added;
    data.nyaa.checked_at = Date.now();
    data.nyaa.ok = true;
  } else {
    data.nyaa = { added, checked_at: Date.now(), ok: true };
  }
  // 重建演员/分类统计（按现有结构尽力而为）
  try {
    const actors = new Set();
    const genres = new Set();
    for (const it of data.items) {
      (it.actors || []).forEach(a => actors.add(typeof a === 'string' ? a : (a.name || '')));
      (it.genres || []).forEach(g => genres.add(typeof g === 'string' ? g : (g.name || '')));
    }
    actors.delete('');
    genres.delete('');
    data.actors = Array.from(actors);
    data.genres = Array.from(genres);
    if (data.actorTotals && typeof data.actorTotals === 'object') data.actorTotals = {};
    if (data.genreTotals && typeof data.genreTotals === 'object') data.genreTotals = {};
  } catch (e) { log('统计重建跳过：', e.message); }

  if (DRY_RUN) { log('dry-run，不写入文件'); return; }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  log('已写入', DATA_FILE);

  // 可选：触发 Cloudflare Pages 重新部署（用 wrangler 上传时不需要这步）
  if (process.env.CF_PAGES_TOKEN && process.env.CF_ACCOUNT_ID) {
    log('检测到 CF token，Pages 部署由 GitHub Actions wrangler 步骤处理');
  }
}

main().catch(e => { console.error('[sync] ERROR:', e.message); process.exit(1); });
