import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronRight, FileText, Loader2 } from 'lucide-react';
import type { DocumentSnapshot } from '../../shared/types';
import type { DocumentFlatNode } from './DocumentTree';
import { TitleTranslationTooltip } from './TitleTranslationTooltip';
import { ipcClient } from '../../lib/ipc-client';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 折叠态下最多显示的状态 icon 数量 */
const MAX_STATUS_ICONS = 3;

/** hover 延迟（ms），超过该时间才触发翻译查询 */
const HOVER_DELAY_MS = 300;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentNodeProps {
  /** 扁平化后的文档节点 */
  node: DocumentFlatNode;
  /** 是否为当前选中文档 */
  isActive: boolean;
  /** 展开/折叠切换 */
  onToggle: (docId: string) => void;
  /** 点击文档行 */
  onClick: (doc: DocumentSnapshot) => void;
  /** 当前文档是否正在翻译中 */
  isTranslating?: boolean;
}

// ---------------------------------------------------------------------------
// 状态 Icon 聚合（T2.3.1）
// ---------------------------------------------------------------------------

interface StatusIcon {
  emoji: string;
  title: string;
}

/**
 * 收集文档关联的状态 icon 列表
 * 🌐 已翻译 | 📝 有 AI 总结 | 🧠 有 NotebookLM 产物 | ⭐ 已收藏
 */
function collectStatusIcons(doc: DocumentSnapshot): StatusIcon[] {
  const icons: StatusIcon[] = [];

  if (doc.cachedTranslation?.available) {
    icons.push({ emoji: '🌐', title: '已翻译' });
  }
  if (doc.hasSummary) {
    icons.push({ emoji: '📝', title: '有 AI 总结' });
  }
  // artifactCount 大于翻译+总结所贡献的数量时，说明有 NotebookLM 产物
  const translationCount = doc.cachedTranslation?.available ? 1 : 0;
  const summaryCount = doc.hasSummary ? 1 : 0;
  // 原件 PDF 本身占 1 个产物位
  const otherArtifacts = doc.artifactCount - 1 - translationCount - summaryCount;
  if (otherArtifacts > 0) {
    icons.push({ emoji: '🧠', title: 'NotebookLM 产物' });
  }
  if (doc.isFavorite) {
    icons.push({ emoji: '⭐', title: '已收藏' });
  }

  return icons;
}

// ---------------------------------------------------------------------------
// DocumentNode 组件
// ---------------------------------------------------------------------------

/**
 * 文档一级节点
 * T2.2.2 [REQ-010, REQ-014] + T2.3.1 [REQ-014] + T3.2.2 标题翻译 Tooltip
 *
 * 渲染文献标题、来源标签（本地/Zotero）、状态 icon 聚合、展开/折叠箭头。
 * 状态 icon 超过 MAX_STATUS_ICONS 个时显示 "+N"。
 * hover ≥ 300ms 时查询标题翻译缓存并显示毛玻璃 Tooltip。
 */
export const DocumentNode: React.FC<DocumentNodeProps> = React.memo(
  ({ node, isActive, onToggle, onClick, isTranslating = false }) => {
    const { doc, expanded, artifactCount } = node;
    const statusIcons = collectStatusIcons(doc);
    const visibleIcons = statusIcons.slice(0, MAX_STATUS_ICONS);
    const overflow = statusIcons.length - MAX_STATUS_ICONS;

    // --- T3.2.2: 标题翻译 Tooltip ---
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [tooltipState, setTooltipState] = useState<{
      visible: boolean;
      translatedTitle: string | null;
      loading: boolean;
      x: number;
      y: number;
    }>({ visible: false, translatedTitle: null, loading: false, x: 0, y: 0 });

    const handleMouseEnter = useCallback((e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      // tooltip 紧贴条目下方，x 对齐条目左边界
      const x = rect.left;
      const y = rect.bottom + 2;

      hoverTimerRef.current = setTimeout(async () => {
        setTooltipState(prev => ({ ...prev, visible: true, loading: true, x, y }));
        try {
          const result = await ipcClient.getTitleTranslation(doc.title);
          setTooltipState(prev => ({
            ...prev,
            translatedTitle: result.translatedTitle,
            loading: false,
          }));
        } catch {
          setTooltipState(prev => ({ ...prev, loading: false }));
        }
      }, HOVER_DELAY_MS);
    }, [doc.title]);

    const handleMouseLeave = useCallback(() => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setTooltipState({ visible: false, translatedTitle: null, loading: false, x: 0, y: 0 });
    }, []);

    // 组件卸载时清除 timer
    useEffect(() => {
      return () => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      };
    }, []);

    return (
      <>
        <div
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors group ${
            isActive
              ? 'bg-[var(--color-selected)]'
              : 'hover:bg-[var(--color-hover)]'
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* 展开/折叠箭头 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(doc.documentId);
            }}
            className="w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-[var(--color-bg-tertiary)] transition-transform"
            aria-label={expanded ? '折叠' : '展开'}
          >
            <ChevronRight
              size={14}
              className={`text-[var(--color-text-quaternary)] transition-transform duration-150 ${
                expanded ? 'rotate-90' : ''
              }`}
            />
          </button>

          {/* 文档标题区域 */}
          <div
            className="flex-1 min-w-0 flex items-center gap-2"
            onClick={() => onClick(doc)}
          >
            <div className="w-6 h-6 rounded-md bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
              <FileText
                size={12}
                className={`${
                  isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-quaternary)]'
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--color-text)] truncate leading-tight">
                {doc.title}
              </p>
              <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-quaternary)]">
                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                  doc.sourceType === 'zotero'
                    ? 'bg-blue-500/10 text-blue-500'
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-quaternary)]'
                }`}>
                  {doc.sourceType === 'zotero' ? 'Zotero' : '本地'}
                </span>
                {artifactCount > 0 && (
                  <span className="text-[var(--color-text-quaternary)]">
                    · {artifactCount} 个产物
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 状态 icon 聚合（T2.3.1） */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* 翻译中旋转动画 */}
            {isTranslating && (
              <Loader2
                size={12}
                className="text-[var(--color-primary)] animate-spin"
                aria-label="翻译中"
              />
            )}
            {/* 静态状态 icon */}
            {!isTranslating && visibleIcons.map((icon) => (
              <span key={icon.emoji} className="text-[11px]" title={icon.title}>
                {icon.emoji}
              </span>
            ))}
            {/* 溢出计数 */}
            {!isTranslating && overflow > 0 && (
              <span
                className="text-[9px] text-[var(--color-text-quaternary)] font-medium"
                title={statusIcons.slice(MAX_STATUS_ICONS).map((i) => i.title).join('、')}
              >
                +{overflow}
              </span>
            )}
          </div>
        </div>

        {/* 标题翻译 Tooltip */}
        <TitleTranslationTooltip
          translatedTitle={tooltipState.translatedTitle}
          visible={tooltipState.visible}
          anchorX={tooltipState.x}
          anchorY={tooltipState.y}
          loading={tooltipState.loading}
        />
      </>
    );
  },
);
DocumentNode.displayName = 'DocumentNode';
