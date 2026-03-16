import React, { useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, FileText, Loader2 } from 'lucide-react';
import type { DocumentSnapshot, DocumentArtifactDto } from '../../shared/types';
import { useDocumentStore } from '../../stores/useDocumentStore';

// ---------------------------------------------------------------------------
// FlatNode — ADR-003 扁平化节点类型
// ---------------------------------------------------------------------------

/** 一级节点：文档 */
interface DocumentFlatNode {
  type: 'document';
  doc: DocumentSnapshot;
  expanded: boolean;
  artifactCount: number;
}

/** 二级节点：产物 */
interface ArtifactFlatNode {
  type: 'artifact';
  artifact: DocumentArtifactDto;
  parentDocId: string;
}

export type FlatNode = DocumentFlatNode | ArtifactFlatNode;

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 一级节点行高 */
const DOC_ROW_HEIGHT = 44;

/** 二级节点行高 */
const ARTIFACT_ROW_HEIGHT = 36;

/** 虚拟化 overscan 行数 */
const OVERSCAN = 5;

// ---------------------------------------------------------------------------
// 产物 icon 映射
// ---------------------------------------------------------------------------

function artifactIcon(kind: string): string {
  switch (kind) {
    case 'original_pdf': return '📄';
    case 'translated_pdf': return '🌐';
    case 'bilingual_pdf': return '🌐';
    case 'ai_summary': return '📝';
    case 'notebooklm_mindmap': return '🧠';
    case 'notebooklm_slides': return '📊';
    case 'notebooklm_quiz': return '❓';
    case 'notebooklm_flashcards': return '🗂️';
    case 'notebooklm_audio': return '🎧';
    case 'notebooklm_report': return '📋';
    default: return '📎';
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentTreeProps {
  /** 文档列表 */
  documents: DocumentSnapshot[];
  /** 当前选中文档 ID */
  activeDocumentId?: string;
  /** 点击文档回调 */
  onDocumentClick?: (doc: DocumentSnapshot) => void;
  /** 点击产物回调 */
  onArtifactClick?: (artifact: DocumentArtifactDto, doc: DocumentSnapshot) => void;
  /** 空状态消息 */
  emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// DocumentTree 主组件
// ---------------------------------------------------------------------------

/**
 * 文档树形列表（虚拟化）
 * T2.2.1 [REQ-010]
 *
 * 使用 @tanstack/react-virtual + ADR-003 FlatNode 扁平化策略
 * 将文档列表渲染为可展开/折叠的虚拟化树形视图。
 */
export const DocumentTree: React.FC<DocumentTreeProps> = ({
  documents,
  activeDocumentId,
  onDocumentClick,
  onArtifactClick,
  emptyMessage = '暂无文档',
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // 从 store 读取展开状态和产物缓存
  const expandedDocIds = useDocumentStore((s) => s.expandedDocIds);
  const artifactsByDocId = useDocumentStore((s) => s.artifactsByDocId);
  const toggleExpand = useDocumentStore((s) => s.toggleExpand);

  // ADR-003: 扁平化 — 遍历文档列表，展开的文档插入其产物子节点
  const flatNodes: FlatNode[] = useMemo(() => {
    return documents.flatMap((doc) => {
      const isExpanded = expandedDocIds.has(doc.documentId);
      const docNode: DocumentFlatNode = {
        type: 'document',
        doc,
        expanded: isExpanded,
        artifactCount: doc.artifactCount,
      };

      if (!isExpanded) return [docNode];

      const artifacts = artifactsByDocId[doc.documentId] ?? [];
      const artifactNodes: ArtifactFlatNode[] = artifacts.map((artifact) => ({
        type: 'artifact',
        artifact,
        parentDocId: doc.documentId,
      }));

      return [docNode, ...artifactNodes];
    });
  }, [documents, expandedDocIds, artifactsByDocId]);

  // 虚拟化
  const rowVirtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      flatNodes[index].type === 'document' ? DOC_ROW_HEIGHT : ARTIFACT_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // 展开/折叠回调
  const handleToggle = useCallback(
    (docId: string) => {
      toggleExpand(docId);
    },
    [toggleExpand],
  );

  // 文档点击回调
  const handleDocClick = useCallback(
    (doc: DocumentSnapshot) => {
      onDocumentClick?.(doc);
    },
    [onDocumentClick],
  );

  // 产物点击回调
  const handleArtifactClick = useCallback(
    (artifact: DocumentArtifactDto, parentDocId: string) => {
      const doc = documents.find((d) => d.documentId === parentDocId);
      if (doc) {
        onArtifactClick?.(artifact, doc);
      }
    },
    [documents, onArtifactClick],
  );

  // 空状态
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 p-6 text-center">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-bg-tertiary)] flex items-center justify-center">
          <FileText size={18} className="text-[var(--color-text-quaternary)]" />
        </div>
        <p className="text-xs text-[var(--color-text-quaternary)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto"
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const node = flatNodes[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {node.type === 'document' ? (
                <DocumentRow
                  node={node}
                  isActive={activeDocumentId === node.doc.documentId}
                  onToggle={handleToggle}
                  onClick={handleDocClick}
                />
              ) : (
                <ArtifactRow
                  node={node}
                  onClick={handleArtifactClick}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DocumentRow — 一级节点（内联占位，Wave 3 提取为 DocumentNode）
// ---------------------------------------------------------------------------

const DocumentRow: React.FC<{
  node: DocumentFlatNode;
  isActive: boolean;
  onToggle: (docId: string) => void;
  onClick: (doc: DocumentSnapshot) => void;
}> = React.memo(({ node, isActive, onToggle, onClick }) => {
  const { doc, expanded, artifactCount } = node;

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors group ${
        isActive
          ? 'bg-[var(--color-selected)]'
          : 'hover:bg-[var(--color-hover)]'
      }`}
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

      {/* 状态 icon 占位（T2.3.1 实现） */}
      <div className="flex items-center gap-0.5 shrink-0">
        {doc.cachedTranslation?.available && (
          <span className="text-[11px]" title="已翻译">🌐</span>
        )}
        {doc.hasSummary && (
          <span className="text-[11px]" title="有 AI 总结">📝</span>
        )}
        {doc.isFavorite && (
          <span className="text-[11px]" title="已收藏">⭐</span>
        )}
      </div>
    </div>
  );
});
DocumentRow.displayName = 'DocumentRow';

// ---------------------------------------------------------------------------
// ArtifactRow — 二级节点（内联占位，Wave 3 提取为 ArtifactNode）
// ---------------------------------------------------------------------------

const ArtifactRow: React.FC<{
  node: ArtifactFlatNode;
  onClick: (artifact: DocumentArtifactDto, parentDocId: string) => void;
}> = React.memo(({ node, onClick }) => {
  const { artifact, parentDocId } = node;
  const isLoading = false; // 占位：将来可用于产物加载状态

  return (
    <div
      className="flex items-center gap-2 pl-9 pr-2 py-1 rounded-lg cursor-pointer hover:bg-[var(--color-hover)] transition-colors"
      onClick={() => onClick(artifact, parentDocId)}
    >
      {/* 产物 icon */}
      <span className="text-sm shrink-0" role="img" aria-label={artifact.kind}>
        {artifactIcon(artifact.kind)}
      </span>

      {/* 产物信息 */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--color-text-secondary)] truncate">
          {artifact.title}
        </p>
        {(artifact.provider || artifact.fileSize) && (
          <p className="text-[9px] text-[var(--color-text-quaternary)] truncate">
            {[
              artifact.provider,
              artifact.fileSize ? formatFileSize(artifact.fileSize) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>

      {/* 加载指示器 */}
      {isLoading && (
        <Loader2 size={12} className="text-[var(--color-text-quaternary)] animate-spin shrink-0" />
      )}
    </div>
  );
});
ArtifactRow.displayName = 'ArtifactRow';

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
