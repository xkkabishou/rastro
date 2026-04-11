import { describe, expect, it } from 'vitest';
import { getSyncTooltip } from './SummaryPanel';

describe('getSyncTooltip', () => {
  it('Obsidian 单目标时默认 tooltip 包含覆盖提醒', () => {
    expect(getSyncTooltip(['obsidian'], null)).toBe(
      '同步到 Obsidian（再次同步将覆盖同名文件）',
    );
  });

  it('Zotero 单目标时默认 tooltip 包含覆盖提醒', () => {
    expect(getSyncTooltip(['zotero'], null)).toBe(
      '同步到 Zotero 附件（再次同步将覆盖同名文件）',
    );
  });

  it('双目标时默认 tooltip 包含覆盖提醒', () => {
    expect(getSyncTooltip(['obsidian', 'zotero'], null)).toBe(
      '同步到笔记库（Obsidian + Zotero，再次同步将覆盖同名文件）',
    );
  });

  it('有错误时仍优先显示错误，不附加覆盖提醒', () => {
    expect(getSyncTooltip(['obsidian'], 'Obsidian 同步失败')).toBe('Obsidian 同步失败');
  });
});
