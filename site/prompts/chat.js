/**
 * 忆海 (Rememori) - 单人私聊对白长效事实提炼提示词
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
    `你是一个客观、严谨的记忆档案分析师。请阅读以下「${playerName}」与「${npcName}」的对话，提炼出客观长效事实小结。\n` +
    timeNotice +
    `\n【极其严苛的第三人称具名与事实提炼铁律】：\n` +
    `1. 必须使用角色全称或备注名（明确写「${playerName}」或「${npcName}」），绝对严厉禁止使用“他”、“她”、“它”、“对方”或“二人”等任何模糊代词！\n` +
    `   - 正确范例：${npcName}向${playerName}透露了自己喜欢收集下界合金。\n` +
    `   - 错误范例：她向他透露了自己喜欢收集下界合金（严厉禁止！）。\n` +
    `2. 仅提炼关键事实、约定承诺、性格习惯、重大事件与明确偏好，彻底过滤“在吗、哈哈、晚安、吃饭了没”等日常口水话寒暄。\n` +
    `3. 结合时间跨度，在事实总结时明确时间背景，杜绝角色认知错乱。\n` +
    `4. 每一条事实独立成行，以“- ”开头，单条不超过 60 字，输出精炼控制在 1~3 条核心事实以内。`
  );
}
