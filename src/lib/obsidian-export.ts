// Obsidian 导出工具函数
// 前端侧的文件名 sanitize 和 front matter 生成

/**
 * 文件名安全化：替换非法字符、截断长度
 * 需与后端 sanitize_filename 保持一致
 */
export function sanitizeFilename(raw: string): string {
  const sanitized = raw.replace(/[/\\:*?"<>|\0]/g, '_').trim();
  if (sanitized.length > 80) {
    return sanitized.slice(0, 80).trimEnd();
  }
  return sanitized;
}

/**
 * 根据总结类型生成文件名
 */
export function getSummaryFilename(summaryType: string = 'default'): string {
  if (summaryType === 'default') {
    return '总结.md';
  }
  return `总结-${summaryType}.md`;
}

/**
 * 根据日期 + session 生成聊天记录文件名
 */
export function getChatFilename(createdAt: string): string {
  // 取前 19 字符并转换为文件名友好格式
  const slug = createdAt
    .slice(0, 19)
    .replace(/[T:]/g, '-');
  return `对话-${slug}.md`;
}
