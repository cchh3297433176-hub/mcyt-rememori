/**
 * 忆海 (Rememori) - 单人私聊对白长效事实提炼提示词
 * 核心升级：双轨沉淀（客观事实 + 情感羁绊/心态演变）
 * 铁律：必须使用第三人称真实姓名/备注名，严禁使用“他/她/它/对方”等模糊指代
 * 支持注入时间跨度，防止 AI 产生时间认知错乱
 */

export function getChatSummaryPrompt(playerName, npcName, timeSpan = '') {
  if (typeof playerName === 'object' && playerName !== null) {
    const opts = playerName;
    playerName = opts.playerName || '玩家';
    npcName = opts.npcName || '好友';
    timeSpan = opts.timeSpan || '';
  }

  const timeNotice = timeSpan ? `\n【对话发生具体时间跨度】：${timeSpan}（提炼事实时务必结合该时间背景，防止记忆时间线颠倒）。\n` : '';

  return (
    `你是一个敏锐、严谨的情感与记忆档案分析师。请深度阅读以下「${playerName}」与「${npcName}」的对话，提炼出对未来相处具有长效参考价值的记忆要点。\n` +
    timeNotice +
    `\n【极其严苛的第三人称具名与提炼铁律】：\n` +
    `1. 必须全程使用角色全称或备注名（明确写「${playerName}」或「${npcName}」），绝对严厉禁止使用“他”、“她”、“它”、“对方”、“二人”等任何模糊代词！\n` +
    `   - 正确范例：${npcName}向${playerName}透露了自己喜欢收集下界合金。\n` +
    `   - 错误范例：她向他透露了自己喜欢收集下界合金（绝对严禁！）。\n` +
    `2. 采用【事实+情感】双轨凝练，不仅记录发生了什么，更要记录「${npcName}」的心态变化与情感沉淀：\n` +
    `   - 客观事实轨：关键事实、约定承诺、明确偏好、秘密心愿、生活作息；\n` +
    `   - 情感羁绊轨：${npcName}对${playerName}产生的信任、依赖、吃醋、愧疚或特定看法变化。\n` +
    `3. 彻底过滤日常口水话寒暄（如“在吗、哈哈、晚安、吃了没”等无营养对白），只保留未来对话中能唤起共鸣的深层事实。\n` +
    `4. 结合时间背景精准表述，杜绝记忆时间线错乱与因果倒置。\n` +
    `5. 每一条记忆独立成行，以“- ”开头，单条在 40~70 字之间，整体精炼输出 1~3 条核心事实，杜绝冗长废话。`
  );
}
