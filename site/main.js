/**
 * 忆海 (Rememori) 独立记忆中枢前端驱动核心
 * - 聚合小手机内存对象 G.npcs 与独立持久化 CUSTOM_NPCS_BACKUP_KEY
 * - 微信小程序现代大头像一行双列微光网格与二级专属多维记忆殿堂
 * - 🌟 结构化事实分类解析：自动识别 [生活习惯]、[约定事项]、[同伴印象]、[心境暗流]、[长效事实] 并分流归位
 * - 接入 MemorySummarizer：支持后台独立低价模型静默总结与第三人称客观具名提炼
 * - 严格的去 Emoji 素雅沉浸式微信 UI 质感与磨砂白提炼按钮交互
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
  activeFilter: 'all',
  searchQuery: '',
  npcs: {},
  currentSelectedNpc: null,
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
  renderDualGridNpcCards();
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

  list = list.filter((m) => {
    if (!m) return false;
    if (m.id === 'mem_init_1' || m.id === 'mem_init_2') return false;
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

// 🌟 结构化事实智能切分与入库
function ingestSummaryFacts(npcName, factsText, originalDialogue, extra = {}) {
  const timeSpan = extra.timeSpan || '';
  const npcId = extra.npcId || '';

  // 针对大模型返回的结构化标签行做细化解析：[生活习惯]、[约定事项]、[同伴印象: xxx]、[心境暗流]、[长效事实]
  const lines = factsText.split('\n').map(l => l.trim()).filter(Boolean);
  let createdCount = 0;

  for (const line of lines) {
    let cleanText = line.replace(/^[-*•\s]+/, '').trim();
    let category = '长效事实';
    let tags = ['客观事实', '长效记忆'];
    let peerName = '';

    const tagMatch = cleanText.match(/^\[(生活习惯|约定事项|同伴印象(?::\s*[^\]]+)?|心境暗流|长效事实)\]\s*/i);
    if (tagMatch) {
      const rawTag = tagMatch[1];
      cleanText = cleanText.slice(tagMatch[0].length).trim();
      if (rawTag.startsWith('同伴印象')) {
        category = '同伴印象';
        const pMatch = rawTag.match(/同伴印象(?::\s*([^\]]+))/i);
        if (pMatch) peerName = pMatch[1].trim();
        tags.push('同伴印象');
        if (peerName) tags.push(`同伴:${peerName}`);
      } else {
        category = rawTag;
        tags.push(rawTag);
      }
    }

    if (timeSpan) tags.push(timeSpan);
    if (!cleanText) continue;

    const newMem = {
      id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      npcId: npcId,
      npcName: npcName,
      category: category,
      peerName: peerName,
      text: cleanText,
      timeSpan: timeSpan,
      tags: tags,
      salience: 0.95,
      timestamp: Date.now(),
      source: '智能事实凝练',
      rawQuote: originalDialogue ? originalDialogue.slice(0, 500) : cleanText,
      embedding: null,
    };

    state.memories.unshift(newMem);
    createdCount++;
  }

  // 兜底：若没有匹配到任何独立行，直接整段作为长效事实入库
  if (createdCount === 0 && factsText.trim()) {
    state.memories.unshift({
      id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      npcId: npcId,
      npcName: npcName,
      category: '长效事实',
      text: factsText.trim(),
      timeSpan: timeSpan,
      tags: ['客观事实', '长效记忆'],
      salience: 0.95,
      timestamp: Date.now(),
      source: '智能事实凝练',
      rawQuote: originalDialogue ? originalDialogue.slice(0, 500) : factsText,
      embedding: null,
    });
  }

  saveMemoriesToStorage();
  renderDualGridNpcCards();
  renderMemoryList();
  updateOverviewStats();

  if (state.currentSelectedNpc && (state.currentSelectedNpc.id === npcId || state.currentSelectedNpc.name === npcName)) {
    openCharacterHall(state.currentSelectedNpc);
  }
}

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
  renderDualGridNpcCards();
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

async function executeRecall(query, roleFilterOverride = null) {
  const q = query.trim();
  let baseCandidates = state.memories.slice();
  const effectiveFilter = roleFilterOverride || state.activeFilter;

  if (effectiveFilter !== 'all') {
    baseCandidates = baseCandidates.filter((m) => m.npcName === effectiveFilter || m.npcId === effectiveFilter);
  }

  if (!q) return baseCandidates;

  if (state.config.vectorEnabled && state.config.apiKey) {
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
      return await rerankMemories(q, topCandidates);
    } catch (err) {
      console.warn('[Rememori] 向量检索降级:', err);
    }
  }

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

/* ================= 3. 界面渲染（微信小程序一行双列大头像网格） ================= */

function updateOverviewStats() {
  const statChars = document.getElementById('stat-total-characters');
  if (statChars) {
    const count = Object.keys(state.npcs).length;
    statChars.textContent = `共 ${count} 位伙伴 · 沉淀 ${state.memories.length} 条往昔`;
  }
}

function updateHeaderEngineState() {
  const statIndexState = document.getElementById('stat-index-state');
  if (statIndexState) {
    statIndexState.textContent = (state.config.vectorEnabled && state.config.apiKey) ? '向量' : '本地';
  }
}

function renderDualGridNpcCards() {
  const gridContainer = document.getElementById('npcDualGridContainer');
  const ingestSelect = document.getElementById('ingest-npc-select');
  if (!gridContainer) return;

  const roleList = Object.values(state.npcs);
  let selectHtml = '';

  const q = state.searchQuery.toLowerCase().trim();
  const filteredRoles = roleList.filter(n => {
    if (!n) return false;
    const name = (n.remark || n.name || n.id || '').toLowerCase();
    const persona = (n.persona || '').toLowerCase();
    return !q || name.includes(q) || persona.includes(q);
  });

  if (filteredRoles.length === 0) {
    gridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 16px; text-align: center; color: rgba(255,255,255,0.4);">
        未发现匹配的角色档案
      </div>
    `;
    return;
  }

  gridContainer.innerHTML = filteredRoles.map(npc => {
    const displayName = npc.remark || npc.name || npc.id || '伙伴';
    const avatarUrl = npc.avatarUrl || npc.avatar || 'assets/icons/chat.png';
    const memCount = state.memories.filter(m => m.npcName === displayName || m.npcId === npc.id || m.npcName === npc.name).length;

    selectHtml += `<option value="${escapeHtml(displayName)}">${escapeHtml(displayName)}</option>`;

    return `
      <div class="npc-grid-card" data-npcid="${escapeHtml(npc.id || npc.name)}">
        <div class="npc-avatar-wrap">
          <img class="npc-avatar-img" src="${escapeHtml(avatarUrl)}" onerror="this.src='assets/icons/chat.png';" alt="${escapeHtml(displayName)}" />
          ${memCount > 0 ? `<div class="npc-badge-pill">${memCount}</div>` : ''}
        </div>
        <div class="npc-card-name">${escapeHtml(displayName)}</div>
        <div class="npc-card-meta">
          <span>${memCount} 条沉淀</span>
          <span>·</span>
          <span>${escapeHtml(npc.region || '在线')}</span>
        </div>
      </div>
    `;
  }).join('');

  if (ingestSelect) ingestSelect.innerHTML = selectHtml;

  gridContainer.querySelectorAll('.npc-grid-card').forEach(card => {
    card.addEventListener('click', () => {
      const nid = card.dataset.npcid;
      const targetNpc = roleList.find(n => (n.id === nid || n.name === nid));
      if (targetNpc) {
        openCharacterHall(targetNpc);
      }
    });
  });
}

// 🌟 打开二级角色专属多维记忆殿堂（支持生活作息、约定、同伴印象、心境与长效事实的分流展示）
function openCharacterHall(npc) {
  state.currentSelectedNpc = npc;
  const hallView = document.getElementById('characterHallView');
  if (!hallView) return;

  const displayName = npc.remark || npc.name || npc.id || '伙伴';
  document.getElementById('hallCharacterName').textContent = displayName;
  document.getElementById('hallHeroTitle').textContent = displayName;
  document.getElementById('hallHeroPersona').textContent = npc.persona ? npc.persona.slice(0, 45) + '...' : '日常MC同伴';

  const avatarImg = document.getElementById('hallAvatarImg');
  if (avatarImg) avatarImg.src = npc.avatarUrl || npc.avatar || 'assets/icons/chat.png';

  const relatedMems = state.memories.filter(m => m.npcName === displayName || m.npcId === npc.id || m.npcName === npc.name);

  // 1. 生活作息与习惯偏好
  const habitMems = relatedMems.filter(m => m.category === '生活习惯' || (m.tags && (m.tags.includes('生活习惯') || m.tags.includes('习惯') || m.tags.includes('偏好') || m.tags.includes('作息'))));
  const countHabits = document.getElementById('countHabits');
  const previewHabits = document.getElementById('previewHabits');
  if (countHabits) countHabits.textContent = `${habitMems.length} 条`;
  if (previewHabits) {
    if (habitMems.length > 0) {
      previewHabits.innerHTML = habitMems.map(m => `• ${escapeHtml(m.text)}`).join('<br>');
    } else {
      previewHabits.textContent = '暂无习惯记录，日常交流中将自然提炼。';
    }
  }

  // 2. 彼此约定与承诺事项
  const countProm = document.getElementById('countPromises');
  const previewProm = document.getElementById('previewPromises');
  const promiseMems = relatedMems.filter(m => m.category === '约定事项' || (m.tags && (m.tags.includes('约定事项') || m.tags.includes('约定') || m.tags.includes('承诺'))));
  if (countProm) countProm.textContent = `${promiseMems.length} 项`;
  if (previewProm) {
    if (promiseMems.length > 0) {
      previewProm.innerHTML = promiseMems.map(m => `• [待履约] ${escapeHtml(m.text)}`).join('<br>');
    } else {
      previewProm.textContent = '暂无待办约定。';
    }
  }

  // 3. 同伴印象与人际圈
  const peerMems = relatedMems.filter(m => m.category === '同伴印象' || (m.tags && m.tags.some(t => t.startsWith('同伴:'))));
  const countPeers = document.getElementById('countPeers');
  const previewPeers = document.getElementById('previewPeers');
  if (countPeers) countPeers.textContent = `${peerMems.length} 条`;
  if (previewPeers) {
    if (peerMems.length > 0) {
      previewPeers.innerHTML = peerMems.map(m => `• ${m.peerName ? `对「${escapeHtml(m.peerName)}」: ` : ''}${escapeHtml(m.text)}`).join('<br>');
    } else {
      previewPeers.textContent = '暂无对其他角色的直观印象。';
    }
  }

  // 4. 心境与内心暗流
  const innerVoice = npc.latestInnerVoice;
  const innerTime = npc.latestInnerVoiceTime;
  const innerMems = relatedMems.filter(m => m.category === '心境暗流' || (m.tags && m.tags.includes('心境暗流')));
  const previewInner = document.getElementById('previewInnerState');
  if (previewInner) {
    let innerHtml = '';
    if (innerVoice) {
      innerHtml += `<div style="margin-bottom:6px;"><span style="color:#07c160;font-size:11px;">[实时心声 · ${innerTime || '刚刚'}]</span> “${escapeHtml(innerVoice)}”</div>`;
    }
    if (innerMems.length > 0) {
      innerHtml += innerMems.map(m => `• [心态变化] ${escapeHtml(m.text)}`).join('<br>');
    }
    previewInner.innerHTML = innerHtml || '暂无心境心声，在私聊中互动将自然沉淀。';
  }

  // 5. 上帝视角客观长效事实
  const coreMems = relatedMems.filter(m => !m.category || m.category === '长效事实' || (!['生活习惯', '约定事项', '同伴印象', '心境暗流'].includes(m.category)));
  const countCore = document.getElementById('countCoreFacts');
  const previewCore = document.getElementById('previewCoreFacts');
  if (countCore) countCore.textContent = `${coreMems.length} 条`;
  if (previewCore) {
    if (coreMems.length > 0) {
      previewCore.innerHTML = coreMems.slice(0, 5).map(m => `• ${escapeHtml(m.text)}`).join('<br>');
    } else {
      previewCore.textContent = '暂无客观事实。';
    }
  }

  // 6. 群聊共通线索
  const previewGroup = document.getElementById('previewGroupEvents');
  if (previewGroup) {
    let sharedGroupName = '';
    try {
      if (window.parent && window.parent.G && window.parent.G.groups) {
        const gList = Object.values(window.parent.G.groups);
        const inGroup = gList.find(g => (g.members && g.members.includes(npc.id)));
        if (inGroup) sharedGroupName = inGroup.name;
      }
    } catch (_) {}
    previewGroup.textContent = sharedGroupName ? `已与群聊「${sharedGroupName}」连通共通记忆通道` : '当前尚未加入任何共同开黑群聊';
  }

  hallView.style.display = 'flex';
}

function renderMemoryList() {
  renderDualGridNpcCards();
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
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      try {
        sessionStorage.setItem('mcyt_skip_lock_screen', 'true');
        sessionStorage.setItem('mcyt_return_desktop_page', '0');
      } catch (_) {}

      const isInsideHost = (window.parent && window.parent !== window);
      if (isInsideHost) {
        try {
          window.parent.postMessage('CLOSE_SANDBOX', '*');
          window.parent.postMessage({ type: 'CLOSE_SANDBOX', action: 'closeSandbox', appId: 'rememori' }, '*');
          if (typeof window.parent.closeInAppSandbox === 'function') {
            window.parent.closeInAppSandbox();
          }
          return;
        } catch (_) {}
      }

      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '../index.html';
      }
    });
  }

  const btnCloseHall = document.getElementById('btn-close-hall');
  if (btnCloseHall) {
    btnCloseHall.addEventListener('click', () => {
      const hallView = document.getElementById('characterHallView');
      if (hallView) hallView.style.display = 'none';
      state.currentSelectedNpc = null;
    });
  }

  const btnHallTrigger = document.getElementById('btnHallTriggerSummary');
  if (btnHallTrigger) {
    btnHallTrigger.addEventListener('click', () => {
      if (!state.currentSelectedNpc) return;
      const npc = state.currentSelectedNpc;
      const displayName = npc.remark || npc.name || npc.id;
      try {
        if (window.parent && typeof window.parent.checkAndTriggerAutoMemorySummary === 'function') {
          window.parent.checkAndTriggerAutoMemorySummary(npc.id || npc.name);
          showToast(`已向记忆中枢发起「${displayName}」的深度多维提炼`);
        } else {
          showToast(`已将「${displayName}」排入后台事实凝练队列`);
        }
      } catch (_) {
        showToast('请求已发送');
      }
    });
  }

  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const modal = document.getElementById(el.dataset.close);
      if (modal) modal.hidden = true;
    });
  });

  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnPickEmbed = document.getElementById('btn-pick-embed');
  const btnPickRerank = document.getElementById('btn-pick-rerank');
  const btnPickSummary = document.getElementById('btn-pick-summary-model');
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

  const pickerSearch = document.getElementById('picker-search-input');
  if (pickerSearch) {
    pickerSearch.addEventListener('input', (e) => {
      renderPickerList(e.target.value);
    });
  }

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
      renderDualGridNpcCards();
      showToast('配置已生效');
    });
  }

  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearBtn) clearBtn.hidden = !state.searchQuery;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        renderDualGridNpcCards();
      }, 200);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      clearBtn.hidden = true;
      renderDualGridNpcCards();
    });
  }

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
        category: '长效事实',
        text,
        tags: rawTags ? rawTags.split(/\s+/).filter(Boolean) : ['手动收纳'],
        salience: parseFloat(salienceRange.value) || 0.8,
        timestamp: Date.now(),
        source: '手动记录',
        rawQuote: `玩家为联系人【${npcName}】手动补充的认知细节。`,
        embedding: null,
      };

      state.memories.unshift(newMem);
      saveMemoriesToStorage();
      document.getElementById('ingest-modal').hidden = true;
      renderDualGridNpcCards();
      updateOverviewStats();
      showToast('角色记忆已收纳');
    });
  }

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
      renderDualGridNpcCards();
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
    const count = Math.min(24, Math.floor((w * h) / 38000));
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

    ctx.fillStyle = 'rgba(7, 193, 96, 0.35)';
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