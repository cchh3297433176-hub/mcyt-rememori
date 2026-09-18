/**
 * 忆海 (Rememori) 独立记忆中枢前端驱动脚本
 * 深度适配《MC YouTube模拟器 6.0》小手机沙盒架构
 * 纯本地离线运行、微信原生白灰极简交互、打通宿主证据链缓存
 */

// 宿主通信与本地存储键位
const STORAGE_KEYS = {
  HOST_AUTOSAVE: 'mcyt_autosave',
  EVIDENCE_CACHE: 'mcyt_rememori_cache_v1',
  LOCAL_MEMORIES: 'mcyt_rememori_memories_store',
};

// 内存运行时状态
const state = {
  memories: [],
  activeFilter: 'all', // 'all' | 'main' | 'alt' | npcName
  searchQuery: '',
  hostPlayerName: '主播',
  hostNpcList: [],
};

/* ================= 1. 初始化与宿主数据装配 ================= */

async function initRememoriApp() {
  bindDomEvents();
  initBackgroundCanvas();
  loadHostContext();
  loadMemoriesFromStorage();
  renderFilterCapsules();
  renderMemoryList();
  updateOverviewStats();
}

/**
 * 读取小手机宿主全局信息（大号名字、NPC列表等）
 */
function loadHostContext() {
  try {
    const rawAutosave = localStorage.getItem(STORAGE_KEYS.HOST_AUTOSAVE);
    if (rawAutosave) {
      const saveData = JSON.parse(rawAutosave);
      if (saveData.player?.ytName) {
        state.hostPlayerName = saveData.player.ytName;
      }
      if (saveData.npcs && typeof saveData.npcs === 'object') {
        state.hostNpcList = Object.keys(saveData.npcs);
      }
    }
  } catch (err) {
    console.warn('[Rememori] 读取宿主全局上下文失败，使用默认配置:', err);
  }
}

/**
 * 从本地存储加载记忆，并自动同化宿主 chat-app 沉淀的新证据
 */
function loadMemoriesFromStorage() {
  let loadedMemories = [];

  // 1. 读取忆海专属本地持久化记忆
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.LOCAL_MEMORIES);
    if (saved) {
      loadedMemories = JSON.parse(saved);
    }
  } catch (e) {
    console.error('[Rememori] 本地记忆读取异常:', e);
  }

  // 2. 检查宿主实时对话证据链沉淀池 (mcyt_rememori_cache_v1)
  try {
    const rawEvidence = localStorage.getItem(STORAGE_KEYS.EVIDENCE_CACHE);
    if (rawEvidence) {
      const evidenceList = JSON.parse(rawEvidence);
      if (Array.isArray(evidenceList)) {
        evidenceList.forEach((evi) => {
          // 避免重复同化
          const exists = loadedMemories.some(
            (m) => m.evidenceId === evi.id || (m.text === evi.text && m.timestamp === evi.timestamp)
          );
          if (!exists) {
            loadedMemories.unshift({
              id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              text: evi.text || evi.summary || '未命名对话交互片段',
              tags: Array.isArray(evi.tags) && evi.tags.length ? evi.tags : [evi.npcName || '日常对话'],
              salience: Number(evi.salience || 0.8),
              timestamp: evi.timestamp || Date.now(),
              source: evi.source || '微信私聊',
              npcName: evi.npcName || '未知角色',
              roleIdentity: evi.roleIdentity || 'main', // 'main' | 'alt'
              evidenceId: evi.id || null,
              rawQuote: evi.rawQuote || evi.text || '无原始对白留底',
            });
          }
        });
      }
    }
  } catch (e) {
    console.warn('[Rememori] 同化宿主对话证据链失败:', e);
  }

  // 默认填充几条示例记忆（若初次打开全空）
  if (loadedMemories.length === 0) {
    loadedMemories = [
      {
        id: 'mem_init_1',
        text: '在直播间与观众约定下周五开启 Minecraft 极限生存挑战联动。',
        tags: ['约定', '直播', '企划'],
        salience: 0.9,
        timestamp: Date.now() - 3600000 * 5,
        source: '微信私聊',
        npcName: 'Dream',
        roleIdentity: 'main',
        rawQuote: 'Dream: 下周五那个极限生存联动，你可别迟到了！我先把服务器白名单配好。',
      },
      {
        id: 'mem_init_2',
        text: '私下更倾向于简约护眼的白灰绿界面质感，讨厌花哨繁复的设计。',
        tags: ['喜好', '偏好'],
        salience: 0.7,
        timestamp: Date.now() - 3600000 * 24,
        source: '自我认知',
        npcName: state.hostPlayerName,
        roleIdentity: 'main',
        rawQuote: '系统偏好设置记录：玩家调整了界面主题并启用了微信原生白灰微绿调色。',
      },
    ];
  }

  state.memories = loadedMemories;
  saveMemoriesToStorage();
}

/**
 * 持久化落盘
 */
function saveMemoriesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.LOCAL_MEMORIES, JSON.stringify(state.memories));
  } catch (e) {
    console.error('[Rememori] 记忆落盘持久化失败:', e);
  }
}

/* ================= 2. 界面渲染逻辑 ================= */

/**
 * 更新顶部数据统计
 */
function updateOverviewStats() {
  const totalEl = document.getElementById('stat-total-memories');
  const evidenceEl = document.getElementById('stat-active-evidence');
  const countMetaEl = document.getElementById('stream-meta-count');

  const total = state.memories.length;
  const withEvidenceCount = state.memories.filter((m) => m.rawQuote).length;

  if (totalEl) totalEl.textContent = total;
  if (evidenceEl) evidenceEl.textContent = withEvidenceCount;
  if (countMetaEl) countMetaEl.textContent = `共 ${getFilteredMemories().length} 条`;
}

/**
 * 渲染筛选胶囊条
 */
function renderFilterCapsules() {
  const container = document.getElementById('filter-capsules');
  if (!container) return;

  // 基础胶囊
  let html = `
    <button type="button" class="capsule ${state.activeFilter === 'all' ? 'active' : ''}" data-filter="all">全量记忆</button>
    <button type="button" class="capsule ${state.activeFilter === 'main' ? 'active' : ''}" data-filter="main">${escapeHtml(state.hostPlayerName)} (大号)</button>
    <button type="button" class="capsule ${state.activeFilter === 'alt' ? 'active' : ''}" data-filter="alt">小号轨迹</button>
  `;

  // 提取记忆中出现的所有 NPC
  const npcSet = new Set();
  state.memories.forEach((m) => {
    if (m.npcName && m.npcName !== state.hostPlayerName) {
      npcSet.add(m.npcName);
    }
  });

  npcSet.forEach((npc) => {
    const isActive = state.activeFilter === `npc:${npc}`;
    html += `<button type="button" class="capsule ${isActive ? 'active' : ''}" data-filter="npc:${escapeHtml(npc)}">${escapeHtml(npc)}</button>`;
  });

  container.innerHTML = html;

  // 绑定胶囊点击事件
  container.querySelectorAll('.capsule').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeFilter = btn.dataset.filter;
      container.querySelectorAll('.capsule').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      renderMemoryList();
      updateOverviewStats();
    });
  });
}

/**
 * 获取过滤后的记忆序列
 */
function getFilteredMemories() {
  const q = state.searchQuery.trim().toLowerCase();
  return state.memories.filter((m) => {
    // 1. 胶囊筛选
    if (state.activeFilter === 'main' && m.roleIdentity === 'alt') return false;
    if (state.activeFilter === 'alt' && m.roleIdentity !== 'alt') return false;
    if (state.activeFilter.startsWith('npc:')) {
      const targetNpc = state.activeFilter.replace('npc:', '');
      if (m.npcName !== targetNpc) return false;
    }

    // 2. 追忆搜索过滤
    if (q) {
      const matchText = (m.text || '').toLowerCase().includes(q);
      const matchNpc = (m.npcName || '').toLowerCase().includes(q);
      const matchTags = Array.isArray(m.tags) && m.tags.some((t) => t.toLowerCase().includes(q));
      const matchQuote = (m.rawQuote || '').toLowerCase().includes(q);
      if (!matchText && !matchNpc && !matchTags && !matchQuote) {
        return false;
      }
    }

    return true;
  });
}

/**
 * 渲染记忆流列表
 */
function renderMemoryList() {
  const listEl = document.getElementById('memory-list');
  const emptyEl = document.getElementById('empty-state');
  if (!listEl) return;

  const filtered = getFilteredMemories();

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.hidden = false;
      listEl.appendChild(emptyEl);
    }
    return;
  }

  if (emptyEl) emptyEl.hidden = true;

  listEl.innerHTML = filtered
    .map((item) => {
      const timeStr = formatTime(item.timestamp);
      const tagsHtml = (item.tags || [])
        .map((tag) => `<span class="tag-badge">#${escapeHtml(tag)}</span>`)
        .join('');

      return `
        <article class="memory-card" data-id="${item.id}">
          <div class="card-top">
            <div class="tag-list">
              ${tagsHtml || '<span class="tag-badge">#记忆</span>'}
            </div>
            <div class="salience-indicator" title="深刻度">★ ${(Number(item.salience) || 0.8).toFixed(1)}</div>
          </div>
          <div class="card-text">${escapeHtml(item.text)}</div>
          <div class="card-foot">
            <span class="card-time">${timeStr} · ${escapeHtml(item.npcName || '通用')}</span>
            <div class="card-actions">
              ${item.rawQuote ? `<button type="button" class="card-btn btn-view-evidence" data-id="${item.id}">凭据</button>` : ''}
              <button type="button" class="card-btn delete btn-delete-mem" data-id="${item.id}">淡忘</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  // 绑定凭据查看与遗忘操作
  listEl.querySelectorAll('.btn-view-evidence').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const mem = state.memories.find((m) => m.id === id);
      if (mem) openEvidenceModal(mem);
    });
  });

  listEl.querySelectorAll('.btn-delete-mem').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      forgetMemory(id);
    });
  });
}

/* ================= 3. 弹窗与核心交互 ================= */

/**
 * 查看真实凭据详情
 */
function openEvidenceModal(mem) {
  const modal = document.getElementById('evidence-modal');
  const quoteBox = document.getElementById('evidence-quote-box');
  const timeVal = document.getElementById('evidence-time-val');
  const npcVal = document.getElementById('evidence-npc-val');
  const badge = document.getElementById('evidence-origin-badge');

  if (!modal) return;

  if (quoteBox) quoteBox.textContent = mem.rawQuote || '无相关对白记录';
  if (timeVal) timeVal.textContent = formatTime(mem.timestamp, true);
  if (npcVal) npcVal.textContent = `${mem.npcName || '通用'} (${mem.source || '微信交互'})`;
  if (badge) badge.textContent = mem.source ? `来源: ${mem.source}` : '真实对话凭据';

  modal.hidden = false;
}

function closeEvidenceModal() {
  const modal = document.getElementById('evidence-modal');
  if (modal) modal.hidden = true;
}

/**
 * 打开收纳记忆弹窗
 */
function openIngestModal() {
  const modal = document.getElementById('ingest-modal');
  const textInput = document.getElementById('ingest-text');
  const tagsInput = document.getElementById('ingest-tags');
  const salienceRange = document.getElementById('ingest-salience');
  const salienceText = document.getElementById('salience-val-text');

  if (!modal) return;
  if (textInput) textInput.value = '';
  if (tagsInput) tagsInput.value = '';
  if (salienceRange) salienceRange.value = '0.8';
  if (salienceText) salienceText.textContent = '0.8';

  modal.hidden = false;
  if (textInput) setTimeout(() => textInput.focus(), 100);
}

function closeIngestModal() {
  const modal = document.getElementById('ingest-modal');
  if (modal) modal.hidden = true;
}

/**
 * 确认保存手动收纳的新记忆
 */
function saveNewMemory() {
  const textInput = document.getElementById('ingest-text');
  const tagsInput = document.getElementById('ingest-tags');
  const salienceRange = document.getElementById('ingest-salience');

  const text = textInput ? textInput.value.trim() : '';
  if (!text) {
    alert('请输入记忆内容描述');
    return;
  }

  const rawTags = tagsInput ? tagsInput.value.trim() : '';
  const tags = rawTags ? rawTags.split(/\s+/).filter(Boolean) : ['手动收纳'];
  const salience = salienceRange ? parseFloat(salienceRange.value) : 0.8;

  const newMem = {
    id: 'mem_' + Date.now(),
    text,
    tags,
    salience,
    timestamp: Date.now(),
    source: '手动记录',
    npcName: state.hostPlayerName,
    roleIdentity: 'main',
    rawQuote: `玩家于 ${formatTime(Date.now(), true)} 手动收纳的记忆随笔。`,
  };

  state.memories.unshift(newMem);
  saveMemoriesToStorage();
  closeIngestModal();
  renderFilterCapsules();
  renderMemoryList();
  updateOverviewStats();
}

/**
 * 淡忘/删除一条记忆
 */
function forgetMemory(id) {
  if (!confirm('确认要让这段记忆在忆海中淡忘消失吗？')) return;
  state.memories = state.memories.filter((m) => m.id !== id);
  saveMemoriesToStorage();
  renderFilterCapsules();
  renderMemoryList();
  updateOverviewStats();
}

/**
 * 返回小手机桌面通信
 */
function handleBackToDesktop() {
  // 1. 如果是在 iframe 内运行，通知宿主 shell 关闭本窗口
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'closeApp', appId: 'rememori' }, '*');
      return;
    } catch (e) {
      console.warn('[Rememori] 向父级发送关闭指令失败:', e);
    }
  }

  // 2. 如果支持原生 history 回退
  if (window.history.length > 1) {
    window.history.back();
  } else {
    // 3. 降级重定向回手机首页
    window.location.href = '../index.html';
  }
}

/* ================= 4. DOM 事件绑定 ================= */

function bindDomEvents() {
  // 返回桌面
  const btnBack = document.getElementById('btn-back');
  if (btnBack) btnBack.addEventListener('click', handleBackToDesktop);

  // 搜索输入
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearBtn) clearBtn.hidden = !state.searchQuery;
      renderMemoryList();
      updateOverviewStats();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      clearBtn.hidden = true;
      renderMemoryList();
      updateOverviewStats();
    });
  }

  // 凭据弹窗关闭
  const btnCloseEvidence = document.getElementById('btn-close-evidence');
  const btnConfirmEvidence = document.getElementById('btn-confirm-evidence');
  if (btnCloseEvidence) btnCloseEvidence.addEventListener('click', closeEvidenceModal);
  if (btnConfirmEvidence) btnConfirmEvidence.addEventListener('click', closeEvidenceModal);

  // 收纳弹窗触发
  const btnOpenIngest = document.getElementById('btn-open-ingest');
  const btnCloseIngest = document.getElementById('btn-close-ingest');
  const btnCancelIngest = document.getElementById('btn-cancel-ingest');
  const btnSaveIngest = document.getElementById('btn-save-ingest');
  const salienceRange = document.getElementById('ingest-salience');
  const salienceText = document.getElementById('salience-val-text');

  if (btnOpenIngest) btnOpenIngest.addEventListener('click', openIngestModal);
  if (btnCloseIngest) btnCloseIngest.addEventListener('click', closeIngestModal);
  if (btnCancelIngest) btnCancelIngest.addEventListener('click', closeIngestModal);
  if (btnSaveIngest) btnSaveIngest.addEventListener('click', saveNewMemory);

  if (salienceRange && salienceText) {
    salienceRange.addEventListener('input', (e) => {
      salienceText.textContent = parseFloat(e.target.value).toFixed(1);
    });
  }

  // 监听宿主通过 postMessage 发送的新增证据（如果有跨窗口热通信）
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'DEPOSIT_REMEMORI_EVIDENCE') {
      loadMemoriesFromStorage();
      renderFilterCapsules();
      renderMemoryList();
      updateOverviewStats();
    }
  });
}

/* ================= 5. 轻量微粒背景画布 ================= */

function initBackgroundCanvas() {
  const canvas = document.getElementById('field');
  if (!canvas) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w, h, nodes;

  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(36, Math.floor((w * h) / 32000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.12,
      r: 1.0 + Math.random() * 1.5,
    }));
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });

  const LINK = 110;
  let running = true;

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  function tick() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);

    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
    }

    // 绘制连线
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < LINK) {
          const alpha = (0.16 * (1 - dist / LINK)).toFixed(3);
          ctx.strokeStyle = `rgba(7, 193, 96, ${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // 绘制微粒圆点
    ctx.fillStyle = 'rgba(7, 193, 96, 0.45)';
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/* ================= 辅助工具函数 ================= */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(timestamp, full = false) {
  if (!timestamp) return '不久前';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '不久前';

  const pad = (n) => String(n).padStart(2, '0');
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  if (full) {
    return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
  }
  return `${month}-${day} ${hours}:${minutes}`;
}

// 启动执行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRememoriApp);
} else {
  initRememoriApp();
}
