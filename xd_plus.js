/* XD 扩展面板 —— 每日推荐 / 热门榜 / 女优墙 / 详情弹窗(剧照轮播+相似推荐) */
(function () {
  if (window.__XDP) return;
  window.__XDP = 1;

  var DATA = null, LOADING = false, WAITERS = [];
  var state = { tab: 'daily' };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function small(url, w) {
    if (!url) return '';
    return url.replace(/w=\d+/, 'w=' + (w || 360));
  }
  function num(v){v=parseFloat(v)||0;return v?(Math.round(v*10)/10).toFixed(1):'-';}
  function hasSub(it) { return !!(it.subtitle && String(it.subtitle).trim()); }
  function title(it) { return it.title_zh || it.title || it.code || ''; }
  function year(it) { return (it.date || '').slice(0, 4); }

  /* ---------- 数据 ---------- */
  function loadData(cb) {
    if (DATA) return cb(DATA);
    WAITERS.push(cb);
    if (LOADING) return;
    LOADING = true;
    fetch('data/movies.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        DATA.__byCode = {};
        (d.items || []).forEach(function (it) { if (it.code) DATA.__byCode[it.code] = it; });
        WAITERS.forEach(function (f) { try { f(DATA); } catch (e) { } });
        WAITERS = [];
      })
      .catch(function () { WAITERS = []; });
  }

  /* ---------- 卡片 ---------- */
  function card(it, badge) {
    var c = el('div', 'xdp-card');
    c.innerHTML =
      '<div class="cv"><img loading="lazy" decoding="async" src="' + small(it.cover, 360) + '" alt="" onerror="this.style.opacity=.15">' +
        '<div class="tags">' + (hasSub(it) ? '<span class="tg">中字</span>' : '') +
        (badge ? '<span class="tg sc">' + esc(badge) + '</span>' : '') + '</div></div>' +
      '<div class="meta"><div class="cd">' + esc(it.code || '') + '</div>' +
      '<div class="ti">' + esc(title(it)) + '</div>' +
      '<div class="sub"><span>' + esc((it.actors || [])[0] || '') + '</span><span>★ ' +
      num(it.score || it.rawScore) + '</span></div></div>';
    c.addEventListener('click', function () { openDetail(it); });
    return c;
  }

  /* ---------- 每日推荐 ---------- */
  function seedOf(d) {
    var s = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    var x = s % 2147483647;
    return function () { x = (x * 48271) % 2147483647; return x / 2147483647; };
  }
  function dailyPicks(n) {
    var items = DATA.items || [];
    var pool = items.filter(function (it) {
      return (it.score || 0) >= 4.0 && (it.votes || 0) > 30 && it.cover;
    });
    if (!pool.length) pool = items.slice();
    var rnd = seedOf(new Date());
    var arr = pool.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    // 优先近两年的作品
    arr.sort(function (a, b) {
      var ya = parseInt(year(a) || 0), yb = parseInt(year(b) || 0);
      return yb - ya;
    });
    var seen = {};
    try { seen = JSON.parse(localStorage.getItem('xdp_daily') || '{}'); } catch (e) { }
    var today = new Date().toISOString().slice(0, 10);
    var out = [], used = seen[today] || [];
    for (var k = 0; k < arr.length && out.length < n; k++) {
      var it = arr[k];
      if (used.indexOf(it.code) >= 0) continue;
      out.push(it);
    }
    if (out.length < n) out = arr.slice(0, n);
    seen[today] = out.map(function (x) { return x.code; });
    try { localStorage.setItem('xdp_daily', JSON.stringify(seen)); } catch (e) { }
    return out;
  }

  /* ---------- 热门榜 ---------- */
  function ranking(n) {
    var items = (DATA.items || []).filter(function (it) { return it.cover; });
    var arr = items.slice().sort(function (a, b) {
      var sa = (a.score || a.rawScore || 0) * Math.log10((a.votes || 0) + 10);
      var sb = (b.score || b.rawScore || 0) * Math.log10((b.votes || 0) + 10);
      return sb - sa;
    });
    return arr.slice(0, n);
  }

  /* ---------- 女优墙 ---------- */
  function actressList(n) {
    var items = DATA.items || [];
    var map = {};
    items.forEach(function (it) {
      (it.actors || []).forEach(function (a) {
        var name = typeof a === 'string' ? a : (a && a.name) || '';
        if (!name) return;
        if (!map[name]) map[name] = { name: name, count: 0, cover: '' };
        map[name].count++;
        if (!map[name].cover && it.cover) map[name].cover = it.cover;
      });
    });
    var av = DATA.avatars || {};
    var list = Object.keys(map).map(function (k) {
      map[k].avatar = (av[k] && typeof av[k] === 'string') ? av[k] : '';
      return map[k];
    });
    list.sort(function (a, b) { return b.count - a.count; });
    return list.slice(0, n || 160);
  }

  /* ---------- 相似推荐 ---------- */
  function similar(it, n) {
    var items = DATA.items || [];
    var actors = {}, makers = {}, genres = {};
    (it.actors || []).forEach(function (a) { actors[a] = 1; });
    if (it.maker) makers[it.maker] = 1;
    (it.genres || []).forEach(function (g) { genres[g] = 1; });
    var scored = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      if (o.code === it.code || !o.cover) continue;
      var s = 0;
      (o.actors || []).forEach(function (a) { if (actors[a]) s += 3; });
      if (o.maker && makers[o.maker]) s += 2;
      (o.genres || []).forEach(function (g) { if (genres[g]) s += 0.5; });
      if (year(o) && year(o) === year(it)) s += 0.5;
      if (s > 0) scored.push([s, o]);
    }
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return scored.slice(0, n || 8).map(function (x) { return x[1]; });
  }

  /* ---------- 面板 ---------- */
  function ensurePanel() {
    if ($('#xdp-mask')) return;
    var mask = el('div', ''); mask.id = 'xdp-mask';
    mask.innerHTML =
      '<div id="xdp"><div class="xdp-top">' +
      '<div class="xdp-title">发现</div>' +
      '<div class="xdp-tabs">' +
      '<button class="xdp-tab on" data-tab="daily">每日推荐</button>' +
      '<button class="xdp-tab" data-tab="rank">热门榜</button>' +
      
      '</div><button class="xdp-close" title="关闭">✕</button></div>' +
      '<div id="xdp-body"></div></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) { if (e.target === mask) closePanel(); });
    $('.xdp-close', mask).addEventListener('click', closePanel);
    Array.prototype.forEach.call(mask.querySelectorAll('.xdp-tab'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(mask.querySelectorAll('.xdp-tab'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        state.tab = b.getAttribute('data-tab');
        renderPanel();
      });
    });
  }

  function renderPanel() {
    var body = $('#xdp-body');
    if (!body) return;
    body.innerHTML = '<div class="xdp-empty">加载中…</div>';
    loadData(function () {
      if (state.tab === 'daily') {
        var picks = dailyPicks(12);
        body.innerHTML = '';
        var g = el('div', 'xdp-grid');
        picks.forEach(function (it, i) { g.appendChild(card(it, '#' + (i + 1))); });
        body.appendChild(g);
      } else if (state.tab === 'rank') {
        var top = ranking(60);
        body.innerHTML = '';
        var g2 = el('div', 'xdp-grid');
        top.forEach(function (it, i) { g2.appendChild(card(it, 'No.' + (i + 1))); });
        body.appendChild(g2);
      } else {
        var list = actressList(180);
        body.innerHTML = '';
        var g3 = el('div', 'xdp-actors');
        list.forEach(function (a) {
          var d = el('div', 'xdp-actor');
          d.innerHTML = '<img loading="lazy" src="' + (a.avatar || small(a.cover, 120)) + '" alt="">' +
            '<div class="nm">' + esc(a.name) + '</div><div class="ct">' + a.count + ' 部</div>';
          d.addEventListener('click', function () { openActress(a.name); });
          g3.appendChild(d);
        });
        body.appendChild(g3);
      }
    });
  }

  function openPanel() { ensurePanel(); $('#xdp-mask').classList.add('on'); renderPanel(); }
  function closePanel() { var m = $('#xdp-mask'); if (m) m.classList.remove('on'); }

  /* ---------- 女优作品 ---------- */
  function openActress(name) {
    loadData(function () {
      var items = (DATA.items || []).filter(function (it) {
        return (it.actors || []).indexOf(name) >= 0;
      });
      items.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var body = $('#xdp-body');
      body.innerHTML = '<div class="xdp-title" style="margin:6px 0 14px">' +
        esc(name) + ' · ' + items.length + ' 部</div>';
      var g = el('div', 'xdp-grid');
      items.slice(0, 200).forEach(function (it) { g.appendChild(card(it)); });
      body.appendChild(g);
    });
  }


  /* ---------- 大图缩放 ---------- */
  var ZOOM = { scale: 1, x: 0, y: 0, src: '' };
  function ensureZoom() {
    if (document.getElementById('xdp-zoom')) return;
    var z = el('div', '');
    z.id = 'xdp-zoom';
    z.innerHTML = '<img id="xdp-zoom-img" alt="">' +
      '<div id="xdp-zoom-tip">滚轮缩放 · 拖动移动 · 双击复位 · Esc 关闭</div>';
    document.body.appendChild(z);
    var img = document.getElementById('xdp-zoom-img');

    function apply() {
      img.style.transform = 'translate(' + ZOOM.x + 'px,' + ZOOM.y + 'px) scale(' + ZOOM.scale + ')';
    }
    z.addEventListener('click', function (e) {
      if (e.target === img) return;
      z.classList.remove('on');
    });
    z.addEventListener('wheel', function (e) {
      e.preventDefault();
      ZOOM.scale = Math.min(6, Math.max(1, ZOOM.scale * (e.deltaY < 0 ? 1.15 : 0.87)));
      if (ZOOM.scale === 1) { ZOOM.x = 0; ZOOM.y = 0; }
      apply();
    }, { passive: false });

    var dragging = false, sx = 0, sy = 0;
    img.addEventListener('mousedown', function (e) {
      dragging = true; sx = e.clientX - ZOOM.x; sy = e.clientY - ZOOM.y;
      img.style.cursor = 'grabbing'; e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      ZOOM.x = e.clientX - sx; ZOOM.y = e.clientY - sy; apply();
    });
    window.addEventListener('mouseup', function () {
      dragging = false; img.style.cursor = 'zoom-out';
    });
    img.addEventListener('dblclick', function () {
      ZOOM.scale = 1; ZOOM.x = 0; ZOOM.y = 0; apply();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') z.classList.remove('on');
    });
  }

  function openZoom(src) {
    ensureZoom();
    var z = document.getElementById('xdp-zoom');
    var img = document.getElementById('xdp-zoom-img');
    ZOOM = { scale: 1, x: 0, y: 0, src: src };
    img.src = src;
    img.style.transform = 'none';
    z.classList.add('on');
  }

  /* ---------- 详情弹窗 ---------- */
  function ensureDetail() {
    if ($('#xdp-detail')) return;
    var d = el('div', ''); d.id = 'xdp-detail';
    d.innerHTML = '<div class="xdp-dwrap"><div class="xdp-top">' +
      '<div class="xdp-title" id="xdp-dtitle"></div>' +
      '<button class="xdp-close" id="xdp-dclose" title="关闭">✕</button></div>' +
      '<div id="xdp-dbody"></div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) d.classList.remove('on'); });
    $('#xdp-dclose', d).addEventListener('click', function () { d.classList.remove('on'); });
  }

  function openDetail(it) {
    ensureDetail();
    loadData(function () {
      // 帧列表：cover + 长截图切块 + samples
      var frames = [];
      if (it.cover) frames.push({ src: it.cover.replace(/w=\d+/, 'w=900'), pos: '50% 20%', fit: 'contain' });
      if (it.shot) {
        var SHOT_STEPS = 6;
        for (var si = 0; si < SHOT_STEPS; si++) {
          frames.push({ src: it.shot, pos: '50% ' + Math.round(si * 100 / (SHOT_STEPS - 1)) + '%', tag: '剧照', fit: 'cover' });
        }
      }
      (it.samples || []).forEach(function (u) { frames.push({ src: u, pos: '50% 50%', fit: 'contain' }); });
      if (!frames.length) frames.push({ src: '', pos: '50% 50%', fit: 'contain' });
      var idx = 0;

      var body = $('#xdp-dbody');
      $('#xdp-dtitle').textContent = it.code || '';
      body.innerHTML =
        '<div class="xdp-dhead">' +
        '<div class="xdp-dleft">' +
        '<div class="xdp-dstage"><img id="xdp-stage" src="' + (frames[0].src || '') + '" alt="" style="object-position:' + (frames[0].pos||'50% 20%') + '">' +
        '<button class="xdp-nav l" id="xdp-prev">‹</button>' +
        '<button class="xdp-nav r" id="xdp-next">›</button></div>' +
        '<div class="xdp-thumbs" id="xdp-thumbs"></div>' +
        '</div>' +
        '<div class="xdp-dinfo">' +
        '<h2>' + esc(title(it)) + '</h2>' +
        '<div class="row"><b>番号</b>' + esc(it.code || '') + '</div>' +
        '<div class="row"><b>发行</b>' + esc(it.date || '-') + '</div>' +
        '<div class="row"><b>片商</b>' + esc(it.maker || '-') + '</div>' +
        '<div class="row"><b>评分</b>★ ' + num(it.score) + '（' + (it.votes || 0) + ' 人评价）</div>' +
        '<div class="row"><b>字幕</b>' + (hasSub(it) ? '有中文字幕' : '暂无') + '</div>' +
        '<div class="row"><b>状态</b>' + (it.link ? '已有下载链接' : '待补链接') + '</div>' +
        '<div class="xdp-actors-inline" id="xdp-actors"></div>' +
        '<div class="xdp-btns">' +
        (it.link ? '<button class="xdp-btn pri" id="xdp-copy">复制 ed2k</button>' : '') +
        (it.url ? '<a class="xdp-btn" href="' + esc(it.url) + '" target="_blank" rel="noopener">打开 JavDB</a>' : '') +
        '<button class="xdp-btn" id="xdp-more">更多同类</button>' +
        '</div></div></div>' +
        '<div class="xdp-sect"><h3>相似推荐</h3><div class="xdp-similar" id="xdp-sim"></div></div>';

      // 剧照缩略
      var thumbs = $('#xdp-thumbs');
      frames.forEach(function (f, i) {
        var t = el('img');
        t.src = f.src; t.loading = 'lazy';
        t.style.objectPosition = f.pos || '50% 20%';
        t.style.objectFit = f.fit || 'cover';
        if (i === 0) t.className = 'on';
        t.addEventListener('click', function () { setIdx(i); });
        thumbs.appendChild(t);
      });
      function setIdx(i) {
        idx = (i + frames.length) % frames.length;
        var st = $('#xdp-stage');
        st.src = frames[idx].src;
        st.style.objectFit = frames[idx].fit || 'contain';
        st.style.objectPosition = frames[idx].pos || '50% 20%';
        Array.prototype.forEach.call(thumbs.children, function (c, k) {
          c.className = (k === idx) ? 'on' : '';
        });
      }
      $('#xdp-stage').style.cursor = 'zoom-in';
      $('#xdp-stage').onclick = function () { openZoom(frames[idx].src); };
      $('#xdp-prev').onclick = function () { setIdx(idx - 1); };
      $('#xdp-next').onclick = function () { setIdx(idx + 1); };
      document.addEventListener('keydown', function (e) {
        if (!$('#xdp-detail').classList.contains('on')) return;
        if (e.key === 'ArrowLeft') setIdx(idx - 1);
        if (e.key === 'ArrowRight') setIdx(idx + 1);
        if (e.key === 'Escape') $('#xdp-detail').classList.remove('on');
      });

      // 演员
      var ai = $('#xdp-actors');
      (it.actors || []).forEach(function (a) {
        var b = el('button', 'xdp-a', esc(a));
        b.onclick = function () { openActress(a); };
        ai.appendChild(b);
      });

      if ($('#xdp-copy')) {
        $('#xdp-copy').onclick = function () {
          try { navigator.clipboard.writeText(it.link); this.textContent = '已复制'; } catch (e) { }
        };
      }
      if ($('#xdp-more')) {
        $('#xdp-more').onclick = function () {
          $('#xdp-detail').classList.remove('on');
          openPanel(); state.tab = 'rank'; renderPanel();
        };
      }

      // 相似
      var sim = similar(it, 8);
      var sg = $('#xdp-sim');
      if (!sim.length) sg.innerHTML = '<div class="xdp-empty">暂无相似作品</div>';
      sim.forEach(function (o) { sg.appendChild(card(o)); });

      $('#xdp-detail').classList.add('on');
    });
  }

  /* ---------- 头部按钮 ---------- */
  function addButton() {
    if ($('#xdp-open')) return;
    var rand = document.querySelector('.header button.random');
    if (!rand) return;
    var b = document.createElement('button');
    b.id = 'xdp-open'; b.type = 'button';
    b.className = rand.className;
    for (var i = 0; i < rand.attributes.length; i++) {
      var at = rand.attributes[i];
      if (at.name.indexOf('data-v-') === 0) b.setAttribute(at.name, at.value);
    }
    b.style.setProperty('margin-left', '0', 'important');
    b.title = '每日推荐 / 热门榜 / 女优墙';
    b.innerHTML = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"></path></svg>' +
      '<span>发现</span>';
    b.addEventListener('click', openPanel);
    var anchor = document.querySelector('.header button.want') || rand.nextSibling;
    anchor.parentElement.insertBefore(b, anchor);
  }


  /* ---------- 主页面卡片接管：点封面打开详情弹窗 ---------- */
  function hookMainCards() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var card = t.closest('.card.clickable');
      if (!card) return;
      // 面板内部不接管
      if (card.closest('#xdp-mask') || card.closest('#xdp-detail')) return;
      // 按钮/链接/操作区不接管
      if (t.closest('button, a, input, select, textarea, .actions')) return;
      var code = card.getAttribute('data-code');
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      loadData(function () {
        var it = DATA.__byCode[code];
        if (it) openDetail(it);
      });
    }, true);
  }

  function boot() {
    addButton();
    hookMainCards();
    new MutationObserver(function () { addButton(); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
