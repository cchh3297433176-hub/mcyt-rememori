/**
 * 忆海 (Rememori) - 提示词统一分发中枢
 */

import { getChatSummaryPrompt } from './chat.js';
import { getStreamSummaryPrompt } from './stream.js';

export const Prompts = {
  chat: getChatSummaryPrompt,
  stream: getStreamSummaryPrompt,
};

export function getPromptForScene(sceneType, params = {}) {
  switch (sceneType) {
    case 'stream':
      return getStreamSummaryPrompt(params.streamerName || '主播');
    case 'chat':
    default:
      return getChatSummaryPrompt(params.playerName || '玩家', params.npcName || '好友');
  }
}
