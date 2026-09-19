/**
 * 忆海 (Rememori) 独立记忆中枢前端驱动核心
 * - 聚合小手机内存对象 G.npcs 与独立持久化 CUSTOM_NPCS_BACKUP_KEY（全面支持自建与导入角色）
 * - 彻底切断逐条碎片口水话对白全量转记忆的旧通道，只保留高质量长效客观事实小结
 * - 接入 MemorySummarizer：支持后台独立低价模型静默总结与第三人称客观具名提炼（附带时间跨度）
 * - 监听 DELETE_NPC_MEMORIES 级联彻底删除角色全部记忆
 * - OpenAI 兼容向量检索 + Reranker 重排序管线，支持严格的角色专属记忆隔离检索
 * - 微信原生居中模型即时过滤弹窗（彻底消除原生 select）
 */

import { MemorySummarizer } from './summarizer.js';

const STORAGE_KEYS = {
  HOST_AUTOSAVE: 'mcyt_autosave',
  HOST_CUSTOM_NPCS: 'mcyt_wechat_custom_npcs',
  EVIDENCE_CACHE: 'mcyt_rememori_cache_v1',
  LOCAL_MEMORIES: 'mcyt_rememori_memories_store',
  VECTOR_CONFIG: 'mcyt_rememori_vector_config',
};

// 状态总线
const state = {
  memories: [],
  activeFilter: 'all', // 'all' | npcName
  searchQuery: '',
  npcs: {}, // 汇聚所有内置与自建 NPC
  config: {
    apiUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    embedModel: 'BAAI/bge-m3',
    rerankModel: 'BAAI/bge-reranker-v2-m3',
    vectorEnabled: false,
  },
  dialogResolver: null,
  cachedRemoteModels: [],
  currentPickerTarget: 'embed',
};

let summarizerInstance = null;

/* ================= 1. 初始化与数据装配 ================= */

async function initRememoriApp() {
  loadConfig();
  summarizerInstance = new MemorySummarizer({
    ingestSummaryFacts,
    showWechatToast: showToast,
  });

  bindDomEvents();
  initBackgroundCanvas();
  loadHostNpcs();
  loadMemoriesFromStorage();
  renderFilterCapsules();
  renderMemoryList();
  updateOverviewStats();
  updateHeaderEngineState();
}

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
 * 完整聚合小手机内存对象、自建联系人独立持久化槽与自动存档
 */
function loadHostNpcs() {
  const mergedNpcs = {};

  try {
    if (window.parent && window.parent.G && typeof window.parent.G.npcs === 'object' && window.parent.G.npcs !== null) {
      Object.assign(mergedNpcs, window.parent.G.npcs);
    }
  } catch (_) {}

  try {
    const rawCustom = localStorage.getItem(STORAGE_KEYS.HOST_CUSTOM_NPCS);
    if (rawCustom) {
      const customNpcs = JSON.parse(rawCustom);
      if (Array.isArray(customNpcs)) {
        customNpcs.forEach((n) => {
          if (n && (n.id || n.name)) {
            const key = n.id || n.name;
            mergedNpcs[key] = n;
          }
        });
      } else if (typeof customNpcs === 'object' && customNpcs !== null) {
        Object.assign(mergedNpcs, customNpcs);
      }
    }
  } catch (e) {
    console.warn('[Rememori] 读取自建联系人备份失败:', e);
  }

  try {
    const rawAutosave = localStorage.getItem(STORAGE_KEYS.HOST_AUTOSAVE);
    if (rawAutosave) {
      const saveData = JSON.parse(rawAutosave);
      if (saveData.npcs && typeof saveData.npcs === 'object') {
        Object.assign(mergedNpcs, saveData.npcs);
      }
    }
  } catch (e) {
    console.warn('[Rememori] 读取自动存档联系人失败:', e);
  }

  if (Object.keys(mergedNpcs).length === 0) {
    mergedNpcs.Dream = { id: 'Dream', name: 'Dream', remark: 'Dream' };
    mergedNpcs.George = { id: 'George', name: 'George', remark: 'George' };
    mergedNpcs.Sapnap = { id: 'Sapnap', name: 'Sapnap', remark: 'Sapnap' };
  }

  state.npcs = mergedNpcs;
}

function loadMemoriesFromStorage() {
  let list = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_MEMORIES);
    if (raw) list = JSON.parse(raw);
  } catch (e) {
    console.error('[Rememori] 读取本地记忆失败:', e);
  }

  // 清洗旧测试假数据与残留的非结构化逐条对白卡片
  list = list.filter((m) => {
    if (!m) return false;
    if (m.id === 'mem_init_1' || m.id === 'mem_init_2') return false;
    // 过滤掉旧版遗留的单条碎片对白，只保留真正的事实小结与手动记录
    if (m.source === '私聊交互' && (!m.tags || !m.tags.includes('客观事实'))) return false;
    return true;
  });

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

// 供 Summarizer 提炼成功后调用的入库方法
function ingestSummaryFacts(npcName, factsText, originalDialogue, extra = {}) {
  const timeSpan = extra.timeSpan || '';
  const npcId = extra.npcId || '';
  const tags = ['客观事实', '长效记忆'];
  if (timeSpan) tags.push(timeSpan);

  const newMem = {
    id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    npcId: npcId,
    npcName: npcName,
    text: factsText,
    timeSpan: timeSpan,
    tags: tags,
    salience: 0.95,
    timestamp: Date.now(),
    source: '智能事实凝练',
    rawQuote: originalDialogue ? originalDialogue.slice(0, 500) : factsText,
    embedding: null,
  };

  state.memories.unshift(newMem);
  saveMemoriesToStorage();
  renderMemoryList();
  updateOverviewStats();
}

/**
 * 级联彻底删除指定角色在忆海中的所有记忆与缓存
 */
function deleteNpcMemories(npcId, npcName) {
  if (!npcId && !npcName) return;

  state.memories = state.memories.filter((m) => {
    if (npcId && m.npcId === npcId) return false;
    if (npcName && m.npcName === npcName) return false;
    if (npcId && m.npcName === npcId) return false;
    return true;
  });

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EVIDENCE_CACHE);
    if (raw) {
      const store = JSON.parse(raw);
      let changed = false;
      Object.keys(store).forEach((k) => {
        if (k.endsWith(`_${npcId}`) || k === npcId || (npcName && k.endsWith(`_${npcName}`))) {
          delete store[k];
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(STORAGE_KEYS.EVIDENCE_CACHE, JSON.stringify(store));
      }
    }
  } catch (_) {}

  if (state.activeFilter === npcName || state.activeFilter === npcId) {
    state.activeFilter = 'all';
  }

  saveMemoriesToStorage();
  loadHostNpcs();
  renderFilterCapsules();
  renderMemoryList();
  updateOverviewStats();
}

/* ================= 2. 向量嵌入与 Reranker 检索管线 ================= */

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
  throw new Error('返回格式缺失 embedding');
}

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

    if (!response.ok) return candidates;

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

// 执行召回，支持传入角色专属过滤，确保单人私聊严格隔离
async function executeRecall(query, roleFilterOverride = null) {
  const q = query.trim();
  let baseCandidates = state.memories.slice();
  const effectiveFilter = roleFilterOverride || state.activeFilter;

  if (effectiveFilter !== 'all') {
    baseCandidates = baseCandidates.filter((m) => m.npcName === effectiveFilter || m.npcId === effectiveFilter);
  }

  if (!q) return baseCandidates;

  if (state.config.vectorEnabled && state.config.apiKey) {
    const feedbackEl = document.getElementById('search-feedback');
    if (feedbackEl) feedbackEl.hidden = false;

    try {
      const qVec = await fetchEmbedding(q);
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

      baseCandidates.sort((a, b) => (b._score || 0) - (a._score || 0));
      const topCandidates = baseCandidates.slice(0, 10);
      const reranked = await rerankMemories(q, topCandidates);
      if (feedbackEl) feedbackEl.hidden = true;
      return reranked;
    } catch (err) {
      console.warn('[Rememori] 向量检索降级:', err);
      if (feedbackEl) feedbackEl.hidden = true;
    }
  }

  // 降级：本地关键词加权
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
  return list.filter((m) => m.npcName === state.activeFilter || m.npcId === state.activeFilter);
}

function renderFilterCapsules() {
  const container = document.getElementById('filter-capsules');
  const ingestSelect = document.getElementById('ingest-npc-select');
  if (!container) return;

  const roleNameMap = new Map();

  Object.values(state.npcs).forEach((npc) => {
    if (!npc) return;
    const name = npc.name || npc.id;
    const displayName = npc.remark ? npc.remark : name;
    if (displayName) roleNameMap.set(displayName, npc);
  });

  state.memories.forEach((m) => {
    if (m.npcName && !roleNameMap.has(m.npcName)) {
      roleNameMap.set(m.npcName, { name: m.npcName });
    }
  });

  let html = `<button type="button" class="capsule ${state.activeFilter === 'all' ? 'active' : ''}" data-filter="all">全角色</button>`;
  let selectHtml = '';

  roleNameMap.forEach((npc, displayName) => {
    const showLabel = npc.remark && npc.name && npc.remark !== npc.name ? `${npc.remark} (${npc.name})` : displayName;
    const isActive = state.activeFilter === displayName;
    html += `<button type="button" class="capsule ${isActive ? 'active' : ''}" data-filter="${escapeHtml(displayName)}">${escapeHtml(showLabel)}</button>`;
    selectHtml += `<option value="${escapeHtml(displayName)}">${escapeHtml(showLabel)}</option>`;
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

      const npcInfo = Object.values(state.npcs).find(n => (n.remark === item.npcName || n.name === item.npcName || n.id === item.npcName));
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

/* ================= 4. 模型单选即时过滤弹窗 ================= */

function openModelPicker(targetType) {
  state.currentPickerTarget = targetType;
  const modal = document.getElementById('model-picker-modal');
  const titleEl = document.getElementById('model-picker-title');
  const searchInput = document.getElementById('picker-search-input');

  if (!modal) return;
  if (targetType === 'embed') titleEl.textContent = '选择 Embedding 向量模型';
  else if (targetType === 'rerank') titleEl.textContent = '选择 Reranker 重排序模型';
  else titleEl.textContent = '选择记忆总结专用模型';

  if (searchInput) searchInput.value = '';

  renderPickerList('');
  modal.hidden = false;
  if (searchInput) setTimeout(() => searchInput.focus(), 80);
}

function renderPickerList(filterKeyword) {
  const container = document.getElementById('model-options-list');
  if (!container) return;

  let currentVal = '';
  if (state.currentPickerTarget === 'embed') currentVal = document.getElementById('cfg-embed-model').value.trim();
  else if (state.currentPickerTarget === 'rerank') currentVal = document.getElementById('cfg-rerank-model').value.trim();
  else currentVal = document.getElementById('cfg-summary-model').value.trim();

  const kw = filterKeyword.toLowerCase().trim();
  const filtered = state.cachedRemoteModels.filter((m) => !kw || m.toLowerCase().includes(kw));

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding: 24px; text-align: center; color: #999; font-size: 13px;">未找到匹配的模型</div>';
    return;
  }

  container.innerHTML = filtered.map((m) => {
    const isSelected = m === currentVal;
    let tag = '';
    if (m.toLowerCase().includes('rerank')) tag = '<span class="model-option-tag">重排</span>';
    else if (m.toLowerCase().includes('embed') || m.toLowerCase().includes('bge')) tag = '<span class="model-option-tag">向量</span>';
    else tag = '<span class="model-option-tag" style="background:#eef6ff;color:#2563eb;">对话</span>';

    return `
      <div class="model-option-item ${isSelected ? 'active' : ''}" data-model="${escapeHtml(m)}">
        <span>${escapeHtml(m)}</span>
        ${tag}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.model-option-item').forEach((item) => {
    item.addEventListener('click', () => {
      const selected = item.dataset.model;
      if (state.currentPickerTarget === 'embed') {
        document.getElementById('cfg-embed-model').value = selected;
      } else if (state.currentPickerTarget === 'rerank') {
        document.getElementById('cfg-rerank-model').value = selected;
      } else {
        document.getElementById('cfg-summary-model').value = selected;
      }
      document.getElementById('model-picker-modal').hidden = true;
      showToast(`已选择 ${selected}`);
    });
  });
}

async function fetchRemoteModelsAndOpen(targetType) {
  let apiUrl = document.getElementById('cfg-api-url').value.trim();
  let apiKey = document.getElementById('cfg-api-key').value.trim();

  if (targetType === 'summary') {
    const useHost = document.getElementById('cfg-summary-use-host').checked;
    if (useHost) {
      try {
        const hostRaw = localStorage.getItem('mc_yt_ai_config') || localStorage.getItem('mcyt_ai_config');
        if (hostRaw) {
          const hostCfg = JSON.parse(hostRaw);
          const hUrl = hostCfg.baseUrl || hostCfg.apiUrl;
          if (hUrl) apiUrl = hUrl;
          if (hostCfg.apiKey) apiKey = hostCfg.apiKey;
        }
      } catch (_) {}
    } else {
      const cUrl = document.getElementById('cfg-summary-api-url').value.trim();
      const cKey = document.getElementById('cfg-summary-api-key').value.trim();
      if (cUrl) apiUrl = cUrl;
      if (cKey) apiKey = cKey;
    }
  }

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

    if (models.length === 0) {
      showToast('未发现可用模型');
      return;
    }

    state.cachedRemoteModels = models;
    openModelPicker(targetType);
  } catch (err) {
    showToast('拉取失败，请检查 Base URL 或密钥');
  }
}

/* ================= 5. 微信质感弹窗交互 ================= */

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

  if (summarizerInstance) {
    const sCfg = summarizerInstance.config;
    const useHostChk = document.getElementById('cfg-summary-use-host');
    const customPanel = document.getElementById('panel-custom-summary-api');
    if (useHostChk) useHostChk.checked = !!sCfg.useHostApi;
    if (customPanel) customPanel.style.display = sCfg.useHostApi ? 'none' : 'block';

    document.getElementById('cfg-summary-api-url').value = sCfg.customApiUrl || '';
    document.getElementById('cfg-summary-api-key').value = sCfg.customApiKey || '';
    document.getElementById('cfg-summary-model').value = sCfg.summaryModel || 'deepseek-ai/DeepSeek-V3';
  }

  modal.hidden = false;
}

/* ================= 6. 事件绑定 ================= */

function bindDomEvents() {
  // 返回桌面
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

  // 通用关闭
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const modal = document.getElementById(el.dataset.close);
      if (modal) modal.hidden = true;
    });
  });

  // 微信 Dialog
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

  // 配置中心弹窗与科普
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnPickEmbed = document.getElementById('btn-pick-embed');
  const btnPickRerank = document.getElementById('btn-pick-rerank');
  const btnPickSummary = document.getElementById('btn-pick-summary-model');
  const btnInfoEngine = document.getElementById('btn-info-engine');
  const btnInfoEmbed = document.getElementById('btn-info-embed');
  const btnInfoRerank = document.getElementById('btn-info-rerank');
  const useHostChk = document.getElementById('cfg-summary-use-host');

  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsModal);
  if (btnPickEmbed) btnPickEmbed.addEventListener('click', () => fetchRemoteModelsAndOpen('embed'));
  if (btnPickRerank) btnPickRerank.addEventListener('click', () => fetchRemoteModelsAndOpen('rerank'));
  if (btnPickSummary) btnPickSummary.addEventListener('click', () => fetchRemoteModelsAndOpen('summary'));

  if (useHostChk) {
    useHostChk.addEventListener('change', (e) => {
      const customPanel = document.getElementById('panel-custom-summary-api');
      if (customPanel) customPanel.style.display = e.target.checked ? 'none' : 'block';
    });
  }

  if (btnInfoEngine) btnInfoEngine.addEventListener('click', () => { document.getElementById('engine-info-modal').hidden = false; });
  if (btnInfoEmbed) btnInfoEmbed.addEventListener('click', () => { document.getElementById('embed-info-modal').hidden = false; });
  if (btnInfoRerank) btnInfoRerank.addEventListener('click', () => { document.getElementById('rerank-info-modal').hidden = false; });

  const pickerSearch = document.getElementById('picker-search-input');
  if (pickerSearch) {
    pickerSearch.addEventListener('input', (e) => {
      renderPickerList(e.target.value);
    });
  }

  // 保存设置
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      state.config.apiUrl = document.getElementById('cfg-api-url').value.trim();
      state.config.apiKey = document.getElementById('cfg-api-key').value.trim();
      state.config.embedModel = document.getElementById('cfg-embed-model').value.trim();
      state.config.rerankModel = document.getElementById('cfg-rerank-model').value.trim();
      state.config.vectorEnabled = document.getElementById('cfg-enable-vector').checked;

      saveConfig();

      if (summarizerInstance) {
        summarizerInstance.saveConfig({
          useHostApi: document.getElementById('cfg-summary-use-host').checked,
          customApiUrl: document.getElementById('cfg-summary-api-url').value.trim(),
          customApiKey: document.getElementById('cfg-summary-api-key').value.trim(),
          summaryModel: document.getElementById('cfg-summary-model').value.trim() || 'deepseek-ai/DeepSeek-V3',
        });
      }

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

  // 追忆搜索
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

  // 手动收纳记忆
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

  // 跨窗口总线监听
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'TRIGGER_REMEMORI_SUMMARY') {
      if (summarizerInstance) {
        summarizerInstance.enqueueTask(event.data);
      }
    } else if (event.data.type === 'DELETE_NPC_MEMORIES') {
      deleteNpcMemories(event.data.npcId, event.data.npcName);
    } else if (event.data.type === 'NPCS_UPDATED') {
      loadHostNpcs();
      renderFilterCapsules();
      renderMemoryList();
      updateOverviewStats();
    }
  });
}

/* ================= 7. 微粒流动背景 ================= */

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
