/**
 * 忆海 (Rememori) - 静默后台记忆总结驱动器
 * - 读取独立配置的低价/专用总结模型
 * - 支持一键继承小手机宿主通用大模型 API
 * - 纯后台非阻塞排队总结，接收时间跨度参数并生成高质量长效事实
 * - 仅在报错时弹窗或轻量提示
 */

import { getPromptForScene } from './prompts/index.js';

const SUMMARY_CONFIG_KEY = 'mcyt_rememori_summary_config';

export class MemorySummarizer {
  constructor(rememoriApp) {
    this.app = rememoriApp;
    this.queue = [];
    this.isProcessing = false;
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem(SUMMARY_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      useHostApi: true, // 默认继承小手机设置中心的大模型 API
      customApiUrl: '',
      customApiKey: '',
      summaryModel: 'deepseek-ai/DeepSeek-V3', // 默认高性价比低价模型
    };
  }

  saveConfig(cfg) {
    this.config = Object.assign(this.config, cfg);
    try {
      localStorage.setItem(SUMMARY_CONFIG_KEY, JSON.stringify(this.config));
    } catch (_) {}
  }

  // 获取最终调用的 API 端点与 Key
  resolveApiCredentials() {
    if (!this.config.useHostApi && this.config.customApiKey) {
      return {
        apiUrl: this.config.customApiUrl || 'https://api.siliconflow.cn/v1',
        apiKey: this.config.customApiKey,
        model: this.config.summaryModel || 'deepseek-ai/DeepSeek-V3',
      };
    }

    // 继承小手机设置中的 API
    let hostUrl = '';
    let hostKey = '';
    let hostModel = '';
    try {
      const hostState = localStorage.getItem('mc_yt_ai_config') || localStorage.getItem('mcyt_ai_config');
      if (hostState) {
        const parsed = JSON.parse(hostState);
        hostUrl = parsed.baseUrl || parsed.apiUrl || '';
        hostKey = parsed.apiKey || '';
        hostModel = parsed.model || '';
      }
    } catch (_) {}

    return {
      apiUrl: hostUrl || this.config.customApiUrl || 'https://api.siliconflow.cn/v1',
      apiKey: hostKey || this.config.customApiKey || '',
      model: this.config.summaryModel || hostModel || 'deepseek-ai/DeepSeek-V3',
    };
  }

  // 接收来自微信、直播等宿主派发的静默总结请求
  enqueueTask(task) {
    this.queue.push(task);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const task = this.queue.shift();
    try {
      await this.executeSummaryTask(task);
    } catch (err) {
      console.error('[Rememori Summarizer] 后台总结失败:', err);
      this.notifyError(`记忆后台总结异常: ${err.message || '网络连接超时'}`);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 1200);
      }
    }
  }

  async executeSummaryTask(task) {
    const creds = this.resolveApiCredentials();
    if (!creds.apiKey) {
      throw new Error('未配置 API 密钥，请在忆海或系统设置中填写');
    }

    const {
      scene = 'chat',
      dialogues = '',
      playerName = '玩家',
      npcName = '好友',
      npcId = '',
      timeSpan = '',
    } = task;

    const systemPrompt = getPromptForScene(scene, { playerName, npcName, timeSpan, npcId });

    const endpoint = creds.apiUrl.replace(/\/+$/, '') + '/chat/completions';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dialogues },
        ],
        temperature: 0.3,
        max_tokens: 450,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 状态码 [${response.status}]: ${errText.slice(0, 100)}`);
    }

    const resData = await response.json();
    let content = resData.choices?.[0]?.message?.content || '';

    // 清洗可能存在的思考链
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    if (content) {
      // 成功提炼事实后，静默存入忆海记忆中枢
      if (this.app && typeof this.app.ingestSummaryFacts === 'function') {
        this.app.ingestSummaryFacts(npcName, content, dialogues, { npcId, timeSpan });
      }
    }
  }

  notifyError(msg) {
    if (this.app && typeof this.app.showWechatToast === 'function') {
      this.app.showWechatToast(msg, 'error');
    } else {
      alert(msg);
    }
  }
}
