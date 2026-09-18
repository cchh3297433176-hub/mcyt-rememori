/**
 * 忆海 (Rememori) 独立记忆中枢前端驱动核心
 * - 专属角色记忆池（解绑用户大小号，绑定内置与自建全部 NPC）
 * - 完整集成 Embedding 向量检索 + Reranker 重排序管线
 * - 硅基流动邀请通道配置
 * - 纯微信质感白灰弹窗，零浏览器原生 prompt/confirm/alert
 */

const STORAGE_KEYS = {
  HOST_AUTOSAVE: 'mcyt_autosave',
  EVIDENCE_CACHE: 'mcyt_rememori_cache_v1',
  LOCAL_MEMORIES: 'mcyt_rememori_memories_store',
  VECTOR_CONFIG: 'mcyt_rememori_vector_config',
};

// 状态总线
const state = {
  memories: [],
  activeFilter: 'all', // 'all' | npcName
  searchQuery: '',
  npcs: {}, // { "Dream": { name, remark, ... }, ... }
  config: {
    apiUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    embedModel: 'BAAI/bge-m3',
    rerankModel: 'BAAI/bge-reranker-v2-m3',
    vectorEnabled: false,
  },
  dialogResolver: null,
};

/* ================= 1. 初始化与数据装配 ================= */

async function initRememoriApp() {
  loadConfig();
  bindDomEvents();
  initBackgroundCanvas();
  loadHostNpcs();
  loadMemoriesFromStorage();
  renderFilterCapsules();
  renderMemoryList();
  updateOverviewStats();
  updateHeaderEngineState();
}

/**
 * 加载向量与重排配置
 */
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VECTOR_CONFIG);
    if (raw) {
      state.config = { ...state.config, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[Rememori] 向量配置读取异常:', e);
  }
}

function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEYS.VECTOR_CONFIG, JSON.stringify(state.config));
  } catch (e) {
    console.error('[Rememori] 向量配置落盘失败:', e);
  }
}

/**
 * 从小手机存档装配内置与玩家自建 NPC 角色池
 */
function loadHostNpcs() {
  try {
    const rawAutosave = localStorage.getItem(STORAGE_KEYS.HOST_AUTOSAVE);
    if (rawAutosave) {
      const data = JSON.parse(rawAutosave);
      if (data.npcs && typeof data.npcs === 'object') {
        state.npcs = data.npcs;
      }
    }
  } catch (err) {
    console.warn('[Rememori] 读取 NPC 角色列表失败:', err);
  }

  // 兜底常用内置角色（防空）
  if (Object.keys(state.npcs).length === 0) {
    state.npcs = {
      Dream: { name: 'Dream', remark: 'Dream' },
      George: { name: 'George', remark: 'George' },
      Sapnap: { name: 'Sapnap', remark: 'Sapnap' },
    };
  }
}

/**
 * 从存储中读取记忆，吸纳宿主沉淀的对话证据，并自动滤除假数据
 */
function loadMemoriesFromStorage() {
  let list = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_MEMORIES);
    if (raw) list = JSON.parse(raw);
  } catch (e) {
    console.error('[Rememori] 读取本地记忆失败:', e);
  }

  // 过滤掉以前写死的假数据（如：极限生存联动、界面质感等与角色无关的假记忆）
  list = list.filter((m) => m.id !== 'mem_init_1' && m.id !== 'mem_init_2');

  // 同化宿主沉淀的真实对白证据池
  try {
    const rawEvidence = localStorage.getItem(STORAGE_KEYS.EVIDENCE_CACHE);
    if (rawEvidence) {
      const evidences = JSON.parse(rawEvidence);
      if (Array.isArray(evidences)) {
        evidences.forEach((evi) => {
          const exists = list.some(
            (m) => m.evidenceId === evi.id || (m.text === evi.text && m.timestamp === evi.timestamp)
          );
          if (!exists) {
            list.unshift({
              id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              npcName: evi.npcName || '通用联系人',
              text: evi.text || evi.summary || '对白记忆',
              tags: Array.isArray(evi.tags) && evi.tags.length ? evi.tags : ['对白留底'],
              salience: Number(evi.salience || 0.8),
              timestamp: evi.timestamp || Date.now(),
              source: evi.source || '私聊交互',
              rawQuote: evi.rawQuote || evi.text || '',
              embedding: null, // 预留高维向量缓存
            });
          }
        });
      }
    }
  } catch (e) {
    console.warn('[Rememori] 同化对白证据失败:', e);
  }

  state.memories = list;
  saveMemoriesToStorage();
}

function saveMemoriesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.LOCAL_MEMORIES, JSON.stringify(state.memories));
  } catch (e) {
    console.error('[Rememori] 记忆持久化失败:', e);
  }
}

/* ================= 2. 向量嵌入与 Reranker 检索中枢 ================= */

/**
 * 远程调用 OpenAI 兼容规范生成文本 Embedding
 */
async function fetchEmbedding(text) {
  if (!state.config.apiKey || !state.config.apiUrl || !state.config.embedModel) {
    throw new Error('未配置 API 密钥或向量模型');
  }

  const endpoint = state.config.apiUrl.replace(/\/+$/, '') + '/embeddings';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.config.apiKey}`,
    },
    body: JSON.stringify({
      model: state.config.embedModel,
      input: text,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`向量接口响应异常 [${response.status}]: ${errText}`);
  }

  const data = await response.json();
  if (data.data && data.data[0] && data.data[0].embedding) {
    return data.data[0].embedding;
  }
  throw new Error('向量返回格式缺失 embedding 字段');
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 远程 Reranker 重排序调用
 */
async function rerankMemories(query, candidates) {
  if (!state.config.rerankModel || !state.config.apiKey || candidates.length <= 1) {
    return candidates;
  }

  const endpoint = state.config.apiUrl.replace(/\/+$/, '') + '/rerank';
  try {
    const documents = candidates.map((c) => c.text);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.config.apiKey}`,
      },
      body: JSON.stringify({
        model: state.config.rerankModel,
        query: query,
        documents: documents,
        top_n: candidates.length,
      }),
    });

    if (!response.ok) return candidates; // 降级返回余弦初筛结果

    const resData = await response.json();
    if (resData.results && Array.isArray(resData.results)) {
      const reordered = [];
      resData.results.forEach((r) => {
        if (candidates[r.index]) {
          candidates[r.index]._rerankScore = r.relevance_score;
          reordered.push(candidates[r.index]);
        }
      });
      return reordered;
    }
  } catch (err) {
    console.warn('[Rememori] Reranker 精排降级:', err);
  }
  return candidates;
}

/**
 * 追忆检索（自动分流：向量+重排 or 本地分词加权）
 */
async function executeRecall(query) {
  const q = query.trim();
  let baseCandidates = state.memories.slice();

  // 1. 角色筛选胶囊门禁
  if (state.activeFilter !== 'all') {
    baseCandidates = baseCandidates.filter((m) => m.npcName === state.activeFilter);
  }

  if (!q) return baseCandidates;

  // 2. 如果开启向量检索且具备 Key
  if (state.config.vectorEnabled && state.config.apiKey) {
    const feedbackEl = document.getElementById('search-feedback');
    if (feedbackEl) feedbackEl.hidden = false;

    try {
      const qVec = await fetchEmbedding(q);
      // 计算每个记忆与检索词的向量相似度
      for (const m of baseCandidates) {
        if (!m.embedding) {
          try {
            m.embedding = await fetchEmbedding(m.text);
          } catch (_) {
            m.embedding = null;
          }
        }
        m._score = m.embedding ? cosineSimilarity(qVec, m.embedding) : 0;
      }

      // 按余弦相似度粗筛
      baseCandidates.sort((a, b) => (b._score || 0) - (a._score || 0));
      const topCandidates = baseCandidates.slice(0, 10);

      // 调用 Reranker 重排序二次精排
      const reranked = await rerankMemories(q, topCandidates);
      if (feedbackEl) feedbackEl.hidden = true;
      return reranked;
    } catch (err) {
      console.warn('[Rememori] 向量检索异常，优雅降级为关键词加权:', err);
      if (feedbackEl) feedbackEl.hidden = true;
    }
  }

  // 3. 本地关键词混合权重计算（降级方案）
  const qLower = q.toLowerCase();
  const qTokens = qLower.split(/\s+/).filter(Boolean);

  return baseCandidates
    .map((m) => {
      let score = 0;
      const text = (m.text || '').toLowerCase();
      const tags = (m.tags || []).map((t) => t.toLowerCase());
      const npc = (m.npcName || '').toLowerCase();

      qTokens.forEach((tok) => {
        if (text.includes(tok)) score += 3;
        if (tags.some((t) => t.includes(tok))) score += 4;
        if (npc.includes(tok)) score += 5;
      });

      score += (m.salience || 0.8) * 2;
      return { ...m, _score: score };
    })
    .filter((m) => m._score > 1.8)
    .sort((a, b) => b._score - a._score);
}

/* ================= 3. 界面渲染 ================= */

function updateOverviewStats() {
  const totalEl = document.getElementById('stat-total-memories');
  const evidenceEl = document.getElementById('stat-active-evidence');
  const countMetaEl = document.getElementById('stream-meta-count');

  const filtered = filterByRoleOnly(state.memories);
  if (totalEl) totalEl.textContent = state.memories.length;
  if (evidenceEl) evidenceEl.textContent = state.memories.filter((m) => m.rawQuote).length;
  if (countMetaEl) countMetaEl.textContent = `当前展示 ${filtered.length} 条`;
}

function updateHeaderEngineState() {
  const subEl = document.getElementById('header-engine-mode');
  const statIndexState = document.getElementById('stat-index-state');
  if (state.config.vectorEnabled && state.config.apiKey) {
    if (subEl) subEl.textContent = state.config.rerankModel ? '向量+Reranker精排' : '高维语义向量';
    if (statIndexState) statIndexState.textContent = '向量';
  } else {
    if (subEl) subEl.textContent = '本地混合检索';
    if (statIndexState) statIndexState.textContent = '本地';
  }
}

function filterByRoleOnly(list) {
  if (state.activeFilter === 'all') return list;
  return list.filter((m) => m.npcName === state.activeFilter);
}

/**
 * 渲染角色联系人胶囊条
 */
function renderFilterCapsules() {
  const container = document.getElementById('filter-capsules');
  const ingestSelect = document.getElementById('ingest-npc-select');
  if (!container) return;

  // 聚合所有角色：包括宿主 NPC 池与记忆中已存在的 NPC
  const npcKeys = new Set(Object.keys(state.npcs));
  state.memories.forEach((m) => {
    if (m.npcName) npcKeys.add(m.npcName);
  });

  let html = `<button type="button" class="capsule ${state.activeFilter === 'all' ? 'active' : ''}" data-filter="all">全角色</button>`;
  let selectHtml = '';

  npcKeys.forEach((key) => {
    const npc = state.npcs[key] || { name: key };
    const label = npc.remark ? `${npc.remark} (${npc.name})` : (npc.name || key);
    const isActive = state.activeFilter === key;
    html += `<button type="button" class="capsule ${isActive ? 'active' : ''}" data-filter="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
    selectHtml += `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
  });

  container.innerHTML = html;
  if (ingestSelect) ingestSelect.innerHTML = selectHtml;

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
 * 渲染记忆卡片流
 */
async function renderMemoryList() {
  const listEl = document.getElementById('memory-list');
  const emptyEl = document.getElementById('empty-state');
  if (!listEl) return;

  const result = await executeRecall(state.searchQuery);

  if (result.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.hidden = false;
      listEl.appendChild(emptyEl);
    }
    return;
  }

  if (emptyEl) emptyEl.hidden = true;

  listEl.innerHTML = result
    .map((item) => {
      const timeStr = formatTime(item.timestamp);
      const tagsHtml = (item.tags || [])
        .map((tag) => `<span class="tag-badge">#${escapeHtml(tag)}</span>`)
        .join('');

      const npcInfo = state.npcs[item.npcName];
      const displayName = npcInfo && npcInfo.remark ? `${npcInfo.remark}` : (item.npcName || '通用联系人');

      return `
        <article class="memory-card" data-id="${item.id}">
          <div class="card-top">
            <div class="tag-list">
              <span class="npc-badge">${escapeHtml(displayName)}</span>
              ${tagsHtml}
            </div>
            <div class="salience-indicator">★ ${(Number(item.salience) || 0.8).toFixed(1)}</div>
          </div>
          <div class="card-text">${escapeHtml(item.text)}</div>
          <div class="card-foot">
            <span class="card-time">${timeStr}</span>
            <div class="card-actions">
              ${item.rawQuote ? `<button type="button" class="card-btn btn-view-evidence" data-id="${item.id}">对白凭据</button>` : ''}
              <button type="button" class="card-btn delete btn-delete-mem" data-id="${item.id}">淡忘</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  listEl.querySelectorAll('.btn-view-evidence').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mem = state.memories.find((m) => m.id === btn.dataset.id);
      if (mem) openEvidenceModal(mem);
    });
  });

  listEl.querySelectorAll('.btn-delete-mem').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showWechatDialog('淡忘记忆', '确定要将这段记忆从角色的认知中抹除吗？抹除后不可恢复。');
      if (ok) {
        state.memories = state.memories.filter((m) => m.id !== btn.dataset.id);
        saveMemoriesToStorage();
        renderMemoryList();
        updateOverviewStats();
        showToast('记忆已淡忘');
      }
    });
  });
}

/* ================= 4. 微信质感弹窗交互 ================= */

function showToast(msg) {
  const toast = document.getElementById('toast-msg');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 1800);
}

function showWechatDialog(title, content) {
  return new Promise((resolve) => {
    const modal = document.getElementById('dialog-modal');
    const titleEl = document.getElementById('dialog-title');
    const contentEl = document.getElementById('dialog-content');
    if (!modal) return resolve(false);

    titleEl.textContent = title;
    contentEl.textContent = content;
    modal.hidden = false;
    state.dialogResolver = resolve;
  });
}

function openEvidenceModal(mem) {
  const modal = document.getElementById('evidence-modal');
  const quoteBox = document.getElementById('evidence-quote-box');
  const timeVal = document.getElementById('evidence-time-val');
  const npcVal = document.getElementById('evidence-npc-val');
  const badge = document.getElementById('evidence-origin-badge');

  if (!modal) return;
  if (quoteBox) quoteBox.textContent = mem.rawQuote || '无原始记录';
  if (timeVal) timeVal.textContent = formatTime(mem.timestamp, true);
  if (npcVal) npcVal.textContent = mem.npcName || '通用联系人';
  if (badge) badge.textContent = mem.source ? `留底渠道: ${mem.source}` : '真实对白留底';

  modal.hidden = false;
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  document.getElementById('cfg-api-url').value = state.config.apiUrl || '';
  document.getElementById('cfg-api-key').value = state.config.apiKey || '';
  document.getElementById('cfg-embed-model').value = state.config.embedModel || '';
  document.getElementById('cfg-rerank-model').value = state.config.rerankModel || '';
  document.getElementById('cfg-enable-vector').checked = !!state.config.vectorEnabled;

  modal.hidden = false;
}

async function fetchAvailableModels() {
  const apiUrl = document.getElementById('cfg-api-url').value.trim();
  const apiKey = document.getElementById('cfg-api-key').value.trim();
  if (!apiKey) {
    showToast('请先填写 API 密钥');
    return;
  }

  showToast('正在拉取模型列表...');
  try {
    const endpoint = apiUrl.replace(/\/+$/, '') + '/models';
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error('拉取失败: ' + res.status);
    const data = await res.json();
    const models = (data.data || []).map((m) => m.id);

    // 智能筛选 embedding 和 rerank
    const embedCandidate = models.find((m) => m.toLowerCase().includes('bge-m3') || m.toLowerCase().includes('embedding'));
    const rerankCandidate = models.find((m) => m.toLowerCase().includes('rerank'));

    if (embedCandidate) document.getElementById('cfg-embed-model').value = embedCandidate;
    if (rerankCandidate) document.getElementById('cfg-rerank-model').value = rerankCandidate;

    showToast(`拉取成功，发现 ${models.length} 个模型`);
  } catch (err) {
    showToast('拉取失败，请检查网络或密钥');
  }
}

/* ================= 5. 事件绑定 ================= */

function bindDomEvents() {
  // 顶栏返回桌面
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'closeApp', appId: 'rememori' }, '*');
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '../index.html';
      }
    });
  }

  // 通用弹窗关闭机制
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const targetId = el.dataset.close;
      const modal = document.getElementById(targetId);
      if (modal) modal.hidden = true;
    });
  });

  // 微信确认框确认与取消
  const btnDialogCancel = document.getElementById('btn-dialog-cancel');
  const btnDialogConfirm = document.getElementById('btn-dialog-confirm');
  if (btnDialogCancel) {
    btnDialogCancel.addEventListener('click', () => {
      document.getElementById('dialog-modal').hidden = true;
      if (state.dialogResolver) state.dialogResolver(false);
    });
  }
  if (btnDialogConfirm) {
    btnDialogConfirm.addEventListener('click', () => {
      document.getElementById('dialog-modal').hidden = true;
      if (state.dialogResolver) state.dialogResolver(true);
    });
  }

  // 配置弹窗
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnFetchModels = document.getElementById('btn-fetch-models');
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsModal);
  if (btnFetchModels) btnFetchModels.addEventListener('click', fetchAvailableModels);

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      state.config.apiUrl = document.getElementById('cfg-api-url').value.trim();
      state.config.apiKey = document.getElementById('cfg-api-key').value.trim();
      state.config.embedModel = document.getElementById('cfg-embed-model').value.trim();
      state.config.rerankModel = document.getElementById('cfg-rerank-model').value.trim();
      state.config.vectorEnabled = document.getElementById('cfg-enable-vector').checked;

      saveConfig();
      document.getElementById('settings-modal').hidden = true;
      updateHeaderEngineState();
      renderMemoryList();
      showToast('配置已生效');
    });
  }

  // 专属推广弹窗
  const btnOpenPromo = document.getElementById('btn-open-promo');
  const btnCopyPromo = document.getElementById('btn-copy-promo');
  if (btnOpenPromo) {
    btnOpenPromo.addEventListener('click', () => {
      document.getElementById('promo-modal').hidden = false;
    });
  }
  if (btnCopyPromo) {
    btnCopyPromo.addEventListener('click', async () => {
      const url = document.getElementById('promo-url-text').textContent;
      try {
        await navigator.clipboard.writeText(url);
        showToast('邀请链接已复制到剪贴板');
      } catch (err) {
        showToast('请长按文本手动复制');
      }
    });
  }

  // 搜索输入
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearBtn) clearBtn.hidden = !state.searchQuery;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        renderMemoryList();
      }, 300);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      clearBtn.hidden = true;
      renderMemoryList();
    });
  }

  // 收纳弹窗
  const btnOpenIngest = document.getElementById('btn-open-ingest');
  const btnSaveIngest = document.getElementById('btn-save-ingest');
  const salienceRange = document.getElementById('ingest-salience');
  const salienceText = document.getElementById('salience-val-text');

  if (btnOpenIngest) {
    btnOpenIngest.addEventListener('click', () => {
      document.getElementById('ingest-text').value = '';
      document.getElementById('ingest-tags').value = '';
      document.getElementById('ingest-modal').hidden = false;
    });
  }

  if (salienceRange && salienceText) {
    salienceRange.addEventListener('input', (e) => {
      salienceText.textContent = parseFloat(e.target.value).toFixed(1);
    });
  }

  if (btnSaveIngest) {
    btnSaveIngest.addEventListener('click', () => {
      const text = document.getElementById('ingest-text').value.trim();
      const rawTags = document.getElementById('ingest-tags').value.trim();
      const npcSelect = document.getElementById('ingest-npc-select');
      const npcName = npcSelect ? npcSelect.value : '通用联系人';

      if (!text) {
        showToast('请输入记忆内容');
        return;
      }

      const newMem = {
        id: 'mem_' + Date.now(),
        npcName,
        text,
        tags: rawTags ? rawTags.split(/\s+/).filter(Boolean) : ['手动收纳'],
        salience: parseFloat(salienceRange.value) || 0.8,
        timestamp: Date.now(),
        source: '手动记录',
        rawQuote: `玩家于 ${formatTime(Date.now(), true)} 为联系人【${npcName}】手动补充的认知细节。`,
        embedding: null,
      };

      state.memories.unshift(newMem);
      saveMemoriesToStorage();
      document.getElementById('ingest-modal').hidden = true;
      renderMemoryList();
      updateOverviewStats();
      showToast('角色记忆已收纳');
    });
  }

  // 跨窗口沉淀监听
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'DEPOSIT_REMEMORI_EVIDENCE') {
      loadMemoriesFromStorage();
      renderFilterCapsules();
      renderMemoryList();
      updateOverviewStats();
    }
  });
}

/* ================= 6. 微粒流动背景 ================= */

function initBackgroundCanvas() {
  const canvas = document.getElementById('field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w, h, nodes;

  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(30, Math.floor((w * h) / 36000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.1,
      r: 1.2 + Math.random() * 1.2,
    }));
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });

  function tick() {
    ctx.clearRect(0, 0, w, h);
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
    }

    ctx.fillStyle = 'rgba(7, 193, 96, 0.4)';
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ================= 辅助函数 ================= */

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
  return full ? `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}` : `${month}-${day} ${hours}:${minutes}`;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRememoriApp);
} else {
  initRememoriApp();
}
