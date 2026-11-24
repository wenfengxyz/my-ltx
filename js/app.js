// ==========================================================================
// Jasna-LTX · Open Design High-Performance Frontend Engine
// ==========================================================================

(function() {
  'use strict';

  // 状态中枢
  const state = {
    allMovies: [],
    filteredMovies: [],
    pageSize: 36,
    currentPage: 1,
    currentSort: 'score',
    confirmFilter: 'all', // 'all' | 'confirmed' | 'unconfirmed'
    searchQuery: '',
    actorQuery: '',
    selectedActor: '',
    selectedGenre: '',
    genresMap: {},
    avatarsMap: {},
    showOnlyWant: false,
    wantList: new Set(JSON.parse(localStorage.getItem('jasna_wants') || '[]')),
    settings: JSON.parse(localStorage.getItem('jasna_settings') || JSON.stringify({
      trimFilename: true,
      showZh: true,
      aria2Url: 'http://localhost:6800/jsonrpc',
      aria2Token: '',
      aria2Dir: '',
      cid115: '0'
    }))
  };

  // DOM 元素引用
  const dom = {
    globalSearch: document.getElementById('global-search'),
    actorSearch: document.getElementById('actor-search'),
    actorList: document.getElementById('actor-list'),
    totalActorsCount: document.getElementById('total-actors-count'),
    cardsContainer: document.getElementById('cards-container'),
    sentinel: document.getElementById('sentinel'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    wantCount: document.getElementById('want-count'),
    btnWant: document.getElementById('btn-want'),
    btnShuffle: document.getElementById('btn-shuffle'),
    btnSettings: document.getElementById('btn-settings'),
    btnBatch: document.getElementById('btn-batch'),
    btnTagDrawer: document.getElementById('btn-tag-drawer'),
    btnMobileSidebar: document.getElementById('btn-mobile-sidebar'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    updateTimeText: document.getElementById('update-time-text'),
    updateIndicator: document.getElementById('update-indicator'),
    tabCountAll: document.getElementById('tab-count-all'),
    tabCountConfirmed: document.getElementById('tab-count-confirmed'),
    tabCountUnconfirmed: document.getElementById('tab-count-unconfirmed'),
    batchCount: document.getElementById('batch-count'),
    activeTagIndicator: document.getElementById('active-tag-indicator'),
    activeFiltersBar: document.getElementById('active-filters-bar'),
    activeTagsContainer: document.getElementById('active-tags-container'),
    btnClearFilters: document.getElementById('btn-clear-filters'),
    // 弹窗
    modalTags: document.getElementById('modal-tags'),
    tagsDrawerBody: document.getElementById('tags-drawer-body'),
    modalBatch: document.getElementById('modal-batch'),
    batchModalCount: document.getElementById('batch-modal-count'),
    batchModalSize: document.getElementById('batch-modal-size'),
    batchLinksText: document.getElementById('batch-links-text'),
    btnCopyAllLinks: document.getElementById('btn-copy-all-links'),
    modalSettings: document.getElementById('modal-settings'),
    // Lightbox
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightbox-img'),
    lightboxCaption: document.getElementById('lightbox-caption'),
    lightboxClose: document.getElementById('lightbox-close')
  };

  // 启动与数据初始化
  async function init() {
    bindEvents();
    loadSettingsIntoUI();
    updateWantBadge();

    try {
      const resp = await fetch('data/movies.json');
      const rawData = await resp.json();

      state.genresMap = rawData.genres || {};
      state.avatarsMap = rawData.avatars || {};

      let rawList = [];
      if (Array.isArray(rawData)) {
        rawList = rawData;
      } else if (rawData.items && Array.isArray(rawData.items)) {
        rawList = rawData.items;
      } else if (rawData.movies && Array.isArray(rawData.movies)) {
        rawList = rawData.movies;
      }

      state.allMovies = rawList.map(item => normalizeMovie(item));

      // 时间戳与巡检状态渲染
      if (rawData.updated_at) {
        const d = new Date(typeof rawData.updated_at === 'number' ? rawData.updated_at : rawData.updated_at);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        dom.updateTimeText.textContent = `资源更新于 ${dateStr}`;
        if (rawData.nyaa) {
          const checkedTime = rawData.nyaa.checked_at ? new Date(rawData.nyaa.checked_at).toLocaleString() : '未知';
          dom.updateIndicator.title = `最后更新时间：${d.toLocaleString()}\n上次自动检查 nyaa：${checkedTime}`;
        }
      }

      applyFilters();
      buildTagsDrawer();
      initObserver();
    } catch (err) {
      console.error('加载资源库失败:', err);
      showToast('加载数据库失败，请刷新重试');
    }
  }

  // 数据规范化适配器
  function normalizeMovie(m) {
    const rawLinks = m.links || (m.download ? [m.download.link] : []);
    const firstLink = rawLinks[0] || '';
    const isEd2k = firstLink.startsWith('ed2k://');
    const isMagnet = firstLink.startsWith('magnet:?');

    let size = m.download?.size || '';
    if (!size && isEd2k) {
      const parts = firstLink.split('|');
      if (parts[3]) {
        const bytes = parseInt(parts[3], 10);
        if (!isNaN(bytes)) {
          size = (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
        }
      }
    }
    if (!size) size = '8.0G';

    const codeClean = (m.code || '').replace('-', '').toLowerCase();
    const dmmFallback = `https://pics.dmm.co.jp/digital/video/${codeClean}/${codeClean}pl.jpg`;
    const primaryCover = m.cover || dmmFallback;

    return {
      code: m.code || '',
      title: m.title || '',
      title_zh: m.title_zh || m.title || '',
      actresses: m.actors || m.actresses || [],
      maker: m.maker || '',
      date: m.date || '',
      added: m.added_at ? new Date(m.added_at).toISOString() : (m.added || ''),
      confirmed: m.pending !== undefined ? !m.pending : (m.confirmed !== false),
      score: m.score || 0,
      javdb_score: m.score || m.javdb_score || 0,
      javdb_votes: m.votes || m.javdb_votes || 0,
      cover_url: primaryCover,
      dmm_fallback: dmmFallback,
      subtitle_url: m.subtitle || m.subtitle_url || '',
      shot: m.shot || '',
      genres: m.genres || [],
      download: {
        type: isEd2k ? 'ed2k' : (isMagnet ? 'magnet' : 'http'),
        size: size,
        link: firstLink
      }
    };
  }

  // 事件监听绑定
  function bindEvents() {
    // 快捷键 / 聚焦搜索
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== dom.globalSearch && document.activeElement !== dom.actorSearch) {
        e.preventDefault();
        dom.globalSearch.focus();
      }
    });

    // 搜索
    dom.globalSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });

    dom.actorSearch.addEventListener('input', (e) => {
      state.actorQuery = e.target.value.trim().toLowerCase();
      renderSidebar();
    });

    // 排序
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentSort = btn.dataset.sort;
        applyFilters();
      });
    });

    // 状态过滤 (全部/已确认/待确认)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.confirmFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    // 想看
    dom.btnWant.addEventListener('click', () => {
      state.showOnlyWant = !state.showOnlyWant;
      dom.btnWant.classList.toggle('active', state.showOnlyWant);
      applyFilters();
    });

    // 乱序
    dom.btnShuffle.addEventListener('click', () => {
      state.filteredMovies.sort(() => Math.random() - 0.5);
      renderCards(true);
      showToast('已随机重排作品');
    });

    // 移动端侧边栏切换
    dom.btnMobileSidebar.addEventListener('click', () => {
      dom.sidebar.classList.toggle('open');
      dom.sidebarBackdrop.classList.toggle('open');
    });
    dom.sidebarBackdrop.addEventListener('click', () => {
      dom.sidebar.classList.remove('open');
      dom.sidebarBackdrop.classList.remove('open');
    });

    // 弹窗控制
    dom.btnTagDrawer.addEventListener('click', () => dom.modalTags.classList.add('open'));
    dom.btnBatch.addEventListener('click', openBatchModal);
    dom.btnSettings.addEventListener('click', () => dom.modalSettings.classList.add('open'));

    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        document.getElementById(modalId).classList.remove('open');
      });
    });

    // 清空筛选
    dom.btnClearFilters.addEventListener('click', () => {
      state.selectedActor = '';
      state.selectedGenre = '';
      applyFilters();
    });

    // 批量复制
    dom.btnCopyAllLinks.addEventListener('click', () => {
      copyToClipboard(dom.batchLinksText.value, '已复制全部有效下载链接');
    });

    // 设置保存
    document.getElementById('btn-save-settings').addEventListener('click', saveSettingsFromUI);

    // Lightbox 关闭
    dom.lightboxClose.addEventListener('click', () => dom.lightbox.classList.remove('open'));
    dom.lightbox.addEventListener('click', (e) => {
      if (e.target === dom.lightbox) dom.lightbox.classList.remove('open');
    });
  }

  // 核心筛选调度
  function applyFilters() {
    let list = state.allMovies.slice();

    // 1. 确认状态
    if (state.confirmFilter === 'confirmed') {
      list = list.filter(m => m.confirmed);
    } else if (state.confirmFilter === 'unconfirmed') {
      list = list.filter(m => !m.confirmed);
    }

    // 2. 想看
    if (state.showOnlyWant) {
      list = list.filter(m => state.wantList.has(m.code));
    }

    // 3. 女优筛选
    if (state.selectedActor) {
      list = list.filter(m => (m.actresses || []).includes(state.selectedActor));
    }

    // 4. 题材标签筛选
    if (state.selectedGenre) {
      list = list.filter(m => (m.genres || []).includes(state.selectedGenre));
    }

    // 5. 关键词检索 (番号、女优、片商、日文/中文标题)
    if (state.searchQuery) {
      const q = state.searchQuery;
      list = list.filter(m => {
        return (m.code && m.code.toLowerCase().includes(q)) ||
               (m.title && m.title.toLowerCase().includes(q)) ||
               (m.title_zh && m.title_zh.toLowerCase().includes(q)) ||
               (m.maker && m.maker.toLowerCase().includes(q)) ||
               ((m.actresses || []).some(a => a.toLowerCase().includes(q)));
      });
    }

    // 6. 排序
    list.sort((a, b) => {
      switch (state.currentSort) {
        case 'score':
          return (b.score || 0) - (a.score || 0);
        case 'date':
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        case 'added':
          return new Date(b.added).getTime() - new Date(a.added).getTime();
        case 'size':
          return parseSize(b.download?.size) - parseSize(a.download?.size);
        case 'code':
          return (a.code || '').localeCompare(b.code || '');
        default:
          return 0;
      }
    });

    state.filteredMovies = list;
    state.currentPage = 1;

    updateCounters();
    updateActiveFiltersBar();
    renderSidebar();
    renderCards(true);
  }

  // 筛选标签栏状态更新
  function updateActiveFiltersBar() {
    const hasFilter = state.selectedActor || state.selectedGenre;
    dom.activeFiltersBar.style.display = hasFilter ? 'flex' : 'none';
    dom.activeTagIndicator.style.display = state.selectedGenre ? 'inline-block' : 'none';

    let html = '';
    if (state.selectedActor) {
      html += `<span class="active-filter-pill" id="pill-remove-actor">女优: ${escapeHtml(state.selectedActor)} ✕</span>`;
    }
    if (state.selectedGenre) {
      const genreName = getGenreName(state.selectedGenre);
      html += `<span class="active-filter-pill" id="pill-remove-genre">题材: ${escapeHtml(genreName)} ✕</span>`;
    }
    dom.activeTagsContainer.innerHTML = html;

    const pillActor = document.getElementById('pill-remove-actor');
    if (pillActor) pillActor.onclick = () => { state.selectedActor = ''; applyFilters(); };

    const pillGenre = document.getElementById('pill-remove-genre');
    if (pillGenre) pillGenre.onclick = () => { state.selectedGenre = ''; applyFilters(); };
  }

  function getGenreName(code) {
    if (state.genresMap[code]) {
      return state.genresMap[code][0] || code; // 中文名称
    }
    return code;
  }

  // 构建标签筛选抽屉
  function buildTagsDrawer() {
    const genreCounts = {};
    state.allMovies.forEach(m => {
      (m.genres || []).forEach(g => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    });

    const sortedGenres = Object.keys(genreCounts)
      .map(k => ({ code: k, name: getGenreName(k), count: genreCounts[k] }))
      .filter(g => g.name && g.name !== g.code)
      .sort((a, b) => b.count - a.count);

    let html = '';
    sortedGenres.forEach(g => {
      const isActive = state.selectedGenre === g.code;
      html += `
        <button class="tag-cloud-item ${isActive ? 'active' : ''}" data-genre="${escapeHtml(g.code)}">
          <span>${escapeHtml(g.name)}</span>
          <span class="badge" style="background:rgba(255,255,255,0.1);font-weight:400;">${g.count}</span>
        </button>
      `;
    });

    dom.tagsDrawerBody.innerHTML = html;
    dom.tagsDrawerBody.querySelectorAll('.tag-cloud-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedGenre = state.selectedGenre === btn.dataset.genre ? '' : btn.dataset.genre;
        dom.modalTags.classList.remove('open');
        applyFilters();
      });
    });
  }

  // 更新各种统计数字
  function updateCounters() {
    const total = state.allMovies.length;
    const confirmed = state.allMovies.filter(m => m.confirmed).length;
    const unconfirmed = total - confirmed;

    dom.tabCountAll.textContent = total;
    dom.tabCountConfirmed.textContent = confirmed;
    dom.tabCountUnconfirmed.textContent = unconfirmed;
    dom.batchCount.textContent = state.filteredMovies.length;
  }

  // 渲染侧边栏女优列表
  function renderSidebar() {
    const actorCounts = {};
    state.allMovies.forEach(m => {
      (m.actresses || []).forEach(a => {
        actorCounts[a] = (actorCounts[a] || 0) + 1;
      });
    });

    let actors = Object.keys(actorCounts).map(name => ({
      name,
      count: actorCounts[name]
    }));

    dom.totalActorsCount.textContent = `${actors.length} 位`;

    if (state.actorQuery) {
      actors = actors.filter(a => a.name.toLowerCase().includes(state.actorQuery));
    }

    actors.sort((a, b) => b.count - a.count);

    let html = `
      <button class="actor-item ${!state.selectedActor ? 'active' : ''}" data-actor="">
        <span>全部女优作品</span>
        <span class="badge-count">${state.allMovies.length}</span>
      </button>
    `;

    actors.forEach(actor => {
      const isActive = state.selectedActor === actor.name;
      html += `
        <button class="actor-item ${isActive ? 'active' : ''}" data-actor="${escapeHtml(actor.name)}">
          <span>${escapeHtml(actor.name)}</span>
          <span class="badge-count">${actor.count}</span>
        </button>
      `;
    });

    dom.actorList.innerHTML = html;

    dom.actorList.querySelectorAll('.actor-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedActor = btn.dataset.actor;
        if (window.innerWidth <= 860) {
          dom.sidebar.classList.remove('open');
          dom.sidebarBackdrop.classList.remove('open');
        }
        applyFilters();
      });
    });
  }

  // 渲染卡片流 (支持双 CDN 容灾 fallback)
  function renderCards(reset = false) {
    if (reset) {
      dom.cardsContainer.innerHTML = '';
      state.currentPage = 1;
    }

    const start = (state.currentPage - 1) * state.pageSize;
    const end = start + state.pageSize;
    const chunk = state.filteredMovies.slice(start, end);

    if (chunk.length === 0 && reset) {
      dom.cardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 80px 0; color: var(--text-muted)">
          <div style="font-size: 2.4rem; margin-bottom: 12px;">🎬</div>
          <div style="font-size: 1rem; font-weight: 500;">未找到符合当前筛选条件的 LTX 资源</div>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();

    chunk.forEach(movie => {
      const isWanted = state.wantList.has(movie.code);
      const title = state.settings.showZh && movie.title_zh ? movie.title_zh : movie.title;
      const actress = (movie.actresses && movie.actresses[0]) || '单体企划';
      const dl = movie.download || { type: 'ed2k', size: '8.0G', link: '' };

      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <div class="cover-wrapper" title="点击放大预览封面">
          <img src="${movie.cover_url}" 
               alt="${movie.code}" 
               loading="lazy" 
               referrerpolicy="no-referrer"
               data-fallback="${movie.dmm_fallback}"
               onerror="if(this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 280 400\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23181820\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%2371717a\\' font-size=\\'16\\' font-family=\\'sans-serif\\' font-weight=\\'bold\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\'>${movie.code}</text></svg>';}">
          <div class="overlay-tools">
            <span class="code-pill" title="点击复制番号">${movie.code}</span>
            <div class="card-top-actions">
              <button class="round-action-btn btn-preview-card" title="查看高清预览">👁️</button>
              <button class="round-action-btn btn-want-card ${isWanted ? 'active' : ''}" title="${isWanted ? '移出想看' : '加入想看'}">
                ${isWanted ? '❤️' : '🤍'}
              </button>
            </div>
          </div>
          ${!movie.confirmed ? '<div class="tag-unconfirmed">待确认</div>' : ''}
          <div class="rating-badge">★ ${movie.score || movie.javdb_score || '4.50'} <small>${movie.javdb_votes || ''}</small></div>
        </div>
        <div class="card-info">
          <h3 class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
          <div class="meta-row">
            <span class="actor-tag">${escapeHtml(actress)}</span>
            <span class="maker-tag">${movie.maker || ''}</span>
            <span class="date-text">${movie.date || ''}</span>
            ${movie.subtitle_url ? `<a href="${movie.subtitle_url}" target="_blank" class="sub-badge" title="中文字幕 (.srt) 下载">字</a>` : ''}
          </div>
          <div class="card-actions">
            <button class="btn-copy-dl" title="一键复制下载链接">
              复制 ${dl.type.toUpperCase()} · ${dl.size}
            </button>
            <button class="btn-send-dl" title="推送到下载器">
              添加到下载
            </button>
          </div>
        </div>
      `;

      // 绑定卡片事件
      card.querySelector('.code-pill').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(movie.code, `已复制番号 ${movie.code}`);
      });

      card.querySelector('.btn-want-card').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWant(movie.code);
        card.querySelector('.btn-want-card').textContent = state.wantList.has(movie.code) ? '❤️' : '🤍';
      });

      // 打开 Lightbox 大图预览
      const openLightboxFn = (e) => {
        e.stopPropagation();
        const previewUrl = movie.shot || movie.cover_url || movie.dmm_fallback;
        dom.lightboxImg.src = previewUrl;
        dom.lightboxCaption.textContent = `${movie.code} · ${actress} · ${title}`;
        dom.lightbox.classList.add('open');
      };

      card.querySelector('.cover-wrapper').addEventListener('click', openLightboxFn);
      card.querySelector('.btn-preview-card').addEventListener('click', openLightboxFn);

      // 复制下载链接
      card.querySelector('.btn-copy-dl').addEventListener('click', (e) => {
        e.stopPropagation();
        let link = dl.link;
        if (state.settings.trimFilename && dl.type === 'ed2k') {
          link = link.replace(/\|file\|[^|]+\|/, `|file|${movie.code}.mp4|`);
        }
        copyToClipboard(link, `已复制 ${movie.code} 下载链接`);
      });

      // 添加到下载器
      card.querySelector('.btn-send-dl').addEventListener('click', (e) => {
        e.stopPropagation();
        sendToDownloader(movie);
      });

      // 女优标签点击
      card.querySelector('.actor-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedActor = actress;
        applyFilters();
      });

      frag.appendChild(card);
    });

    dom.cardsContainer.appendChild(frag);
  }

  // 无限滚动
  function initObserver() {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        const totalPages = Math.ceil(state.filteredMovies.length / state.pageSize);
        if (state.currentPage < totalPages) {
          state.currentPage++;
          renderCards(false);
        }
      }
    }, { threshold: 0.1 });

    observer.observe(dom.sentinel);
  }

  // 剪贴板
  function copyToClipboard(text, message = '已复制到剪贴板') {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => showToast(message));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(message);
    }
  }

  let toastTimer = null;
  function showToast(msg) {
    clearTimeout(toastTimer);
    dom.toastText.textContent = msg;
    dom.toast.classList.add('show');
    toastTimer = setTimeout(() => {
      dom.toast.classList.remove('show');
    }, 2400);
  }

  function toggleWant(code) {
    if (state.wantList.has(code)) {
      state.wantList.delete(code);
      showToast(`已移出想看：${code}`);
    } else {
      state.wantList.add(code);
      showToast(`已加入想看：${code}`);
    }
    localStorage.setItem('jasna_wants', JSON.stringify(Array.from(state.wantList)));
    updateWantBadge();
    if (state.showOnlyWant) {
      applyFilters();
    }
  }

  function updateWantBadge() {
    dom.wantCount.textContent = state.wantList.size;
  }

  // 批量操作
  function openBatchModal() {
    dom.batchModalCount.textContent = state.filteredMovies.length;
    let totalGB = 0;
    const links = [];

    state.filteredMovies.forEach(m => {
      if (m.download && m.download.link) {
        links.push(m.download.link);
        totalGB += parseSize(m.download.size);
      }
    });

    dom.batchModalSize.textContent = `${totalGB.toFixed(1)} GB`;
    dom.batchLinksText.value = links.join('\n');
    dom.modalBatch.classList.add('open');
  }

  // 推送至 Aria2
  async function sendToDownloader(movie) {
    const link = movie.download?.link;
    if (!link) {
      showToast('该作品暂无下载链接');
      return;
    }

    if (!state.settings.aria2Url) {
      dom.modalSettings.classList.add('open');
      showToast('请先配置 Aria2 RPC 地址');
      return;
    }

    showToast(`正在推送 ${movie.code} 到 Aria2...`);

    const rpcPayload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'aria2.addUri',
      params: []
    };

    if (state.settings.aria2Token) {
      rpcPayload.params.push(`token:${state.settings.aria2Token}`);
    }

    rpcPayload.params.push([link]);

    const options = {};
    if (state.settings.aria2Dir) options.dir = state.settings.aria2Dir;
    if (Object.keys(options).length > 0) rpcPayload.params.push(options);

    try {
      const resp = await fetch(state.settings.aria2Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcPayload)
      });
      const res = await resp.json();
      if (res.result) {
        showToast(`✅ ${movie.code} 成功添加至 Aria2！`);
      } else {
        throw new Error(res.error?.message || '未知错误');
      }
    } catch (e) {
      console.warn('Aria2 推送失败:', e);
      showToast(`推送失败: 浏览器跨域阻止或 Aria2 未启动，已自动复制链接`);
      copyToClipboard(link);
    }
  }

  function loadSettingsIntoUI() {
    document.getElementById('setting-trim-filename').checked = state.settings.trimFilename;
    document.getElementById('setting-show-zh').checked = state.settings.showZh;
    document.getElementById('setting-aria2-url').value = state.settings.aria2Url || '';
    document.getElementById('setting-aria2-token').value = state.settings.aria2Token || '';
    document.getElementById('setting-aria2-dir').value = state.settings.aria2Dir || '';
  }

  function saveSettingsFromUI() {
    state.settings.trimFilename = document.getElementById('setting-trim-filename').checked;
    state.settings.showZh = document.getElementById('setting-show-zh').checked;
    state.settings.aria2Url = document.getElementById('setting-aria2-url').value.trim();
    state.settings.aria2Token = document.getElementById('setting-aria2-token').value.trim();
    state.settings.aria2Dir = document.getElementById('setting-aria2-dir').value.trim();

    localStorage.setItem('jasna_settings', JSON.stringify(state.settings));
    dom.modalSettings.classList.remove('open');
    showToast('配置已保存');
    applyFilters();
  }

  function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/([\d.]+)\s*([GMK]?)B?/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    const unit = (match[2] || 'G').toUpperCase();
    if (unit === 'G') return val;
    if (unit === 'M') return val / 1024;
    if (unit === 'K') return val / (1024 * 1024);
    return val;
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  window.addEventListener('DOMContentLoaded', init);
})();