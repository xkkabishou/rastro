import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentSnapshot, DocumentArtifactDto } from '../../shared/types';
import type { FlatNode } from './DocumentTree';

// ---------------------------------------------------------------------------
// 右键菜单操作类型
// ---------------------------------------------------------------------------

/** 所有可能的右键菜单操作 */
export type ContextMenuAction =
  // 一级节点（文献）操作
  | 'translate'
  | 'generate_summary'
  | 'reveal_in_finder'
  | 'remove_from_history'
  | 'toggle_favorite'
  // 二级节点（翻译产物）操作
  | 'view_translation_detail'
  | 'retranslate'
  | 'delete_translation'
  // 二级节点（AI 总结）操作
  | 'view_summary'
  | 'regenerate_summary'
  | 'export_summary_md'
  // 二级节点（NotebookLM 产物）操作
  | 'open_artifact'
  | 'download_artifact'
  | 'delete_artifact';

// ---------------------------------------------------------------------------
// 菜单项类型
// ---------------------------------------------------------------------------

interface MenuItem {
  /** 菜单项显示文本 */
  label: string;
  /** 对应的操作 */
  action: ContextMenuAction;
  /** 是否灰显 */
  disabled?: boolean;
  /** 是否为危险操作（红色文字） */
  danger?: boolean;
}

/** 分隔符标记 */
interface MenuSeparator {
  type: 'separator';
}

type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}

// ---------------------------------------------------------------------------
// 菜单项生成逻辑
// ---------------------------------------------------------------------------

/**
 * 为一级节点（文献）生成菜单项
 * PRD §5.3: 翻译全文 / 生成 AI 总结 / ── / ☆ 收藏 / 在 Finder 中显示 / ── / 从历史中移除
 */
function buildDocumentMenuItems(doc: DocumentSnapshot): MenuEntry[] {
  const hasTranslation = doc.cachedTranslation?.available ?? false;
  const hasSummary = doc.hasSummary;

  return [
    {
      label: hasTranslation ? '重新翻译全文' : '翻译全文',
      action: 'translate' as ContextMenuAction,
    },
    {
      label: hasSummary ? '重新生成 AI 总结' : '生成 AI 总结',
      action: 'generate_summary' as ContextMenuAction,
    },
    { type: 'separator' as const },
    {
      label: doc.isFavorite ? '取消收藏' : '☆ 收藏',
      action: 'toggle_favorite' as ContextMenuAction,
    },
    {
      label: '在 Finder 中显示',
      action: 'reveal_in_finder' as ContextMenuAction,
    },
    { type: 'separator' as const },
    {
      label: '从历史中移除',
      action: 'remove_from_history' as ContextMenuAction,
      danger: true,
    },
  ];
}

/**
 * 为二级节点（产物）生成菜单项
 * PRD §5.3: 根据 artifact kind 生成不同菜单
 */
function buildArtifactMenuItems(
  artifact: DocumentArtifactDto,
  doc: DocumentSnapshot,
): MenuEntry[] {
  const kind = artifact.kind;

  // 翻译 PDF
  if (kind === 'translated_pdf' || kind === 'bilingual_pdf') {
    return [
      { label: '查看翻译详情', action: 'view_translation_detail' },
      { label: '重新翻译', action: 'retranslate' },
      { type: 'separator' },
      { label: '删除翻译', action: 'delete_translation', danger: true },
    ];
  }

  // AI 总结
  if (kind === 'ai_summary') {
    return [
      { label: '查看总结', action: 'view_summary' },
      { label: '重新生成', action: 'regenerate_summary' },
      { type: 'separator' },
      { label: '导出为 Markdown', action: 'export_summary_md' },
    ];
  }

  // NotebookLM 产物
  if (kind.startsWith('notebooklm_')) {
    return [
      { label: '打开', action: 'open_artifact' },
      { label: '下载', action: 'download_artifact', disabled: !!artifact.filePath },
      { type: 'separator' },
      { label: '删除', action: 'delete_artifact', danger: true },
    ];
  }

  // 原件 PDF — 仅在 Finder 中显示
  if (kind === 'original_pdf') {
    return [
      { label: '在 Finder 中显示', action: 'reveal_in_finder' },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentContextMenuProps {
  /** 包裹的子元素（节点渲染内容） */
  children: React.ReactNode;
  /** 扁平化节点 */
  node: FlatNode;
  /** 所属文档 */
  doc: DocumentSnapshot;
  /** 菜单操作回调 */
  onAction: (action: ContextMenuAction, node: FlatNode, doc: DocumentSnapshot) => void;
}

// ---------------------------------------------------------------------------
// 右键菜单 Portal 组件
// ---------------------------------------------------------------------------

interface ContextMenuPortalProps {
  items: MenuEntry[];
  position: { x: number; y: number };
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  items,
  position,
  onAction,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // 延迟绑定，避免当前的 contextmenu 事件触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('contextmenu', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 确保菜单不超出视窗
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const { innerWidth, innerHeight } = window;

    if (rect.right > innerWidth) {
      menuRef.current.style.left = `${innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > innerHeight) {
      menuRef.current.style.top = `${innerHeight - rect.height - 8}px`;
    }
  }, [position]);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu-overlay"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        zIndex: 9999,
      }}
    >
      <div className="min-w-[180px] py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] shadow-lg backdrop-blur-xl">
        {items.map((entry, index) => {
          if (isSeparator(entry)) {
            return (
              <div
                key={`sep-${index}`}
                className="my-1 border-t border-[var(--color-separator)]"
              />
            );
          }
          return (
            <button
              key={entry.action}
              disabled={entry.disabled}
              onClick={(e) => {
                e.stopPropagation();
                onAction(entry.action);
                onClose();
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                entry.disabled
                  ? 'text-[var(--color-text-quaternary)] cursor-not-allowed'
                  : entry.danger
                    ? 'text-red-500 hover:bg-red-500/10'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
};

// ---------------------------------------------------------------------------
// DocumentContextMenu — 右键菜单容器
// ---------------------------------------------------------------------------

/**
 * 右键菜单组件
 * T2.4.1 [REQ-015]
 *
 * 包裹 DocumentNode / ArtifactNode，拦截 contextmenu 事件，
 * 根据节点类型（一级/二级）和状态动态生成菜单项。
 */
export const DocumentContextMenu: React.FC<DocumentContextMenuProps> = ({
  children,
  node,
  doc,
  onAction,
}) => {
  const [menuState, setMenuState] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({ x: e.clientX, y: e.clientY });
  }, []);

  const handleClose = useCallback(() => {
    setMenuState(null);
  }, []);

  const handleAction = useCallback(
    (action: ContextMenuAction) => {
      onAction(action, node, doc);
    },
    [onAction, node, doc],
  );

  // 根据节点类型生成菜单项
  const menuItems: MenuEntry[] =
    node.type === 'document'
      ? buildDocumentMenuItems(doc)
      : buildArtifactMenuItems(node.artifact, doc);

  // 无菜单项时不渲染
  if (menuItems.length === 0) {
    return <>{children}</>;
  }

  return (
    <>
      <div onContextMenu={handleContextMenu}>
        {children}
      </div>
      {menuState && (
        <ContextMenuPortal
          items={menuItems}
          position={menuState}
          onAction={handleAction}
          onClose={handleClose}
        />
      )}
    </>
  );
};
