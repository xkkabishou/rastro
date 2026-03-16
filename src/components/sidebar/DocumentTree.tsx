import React, { useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText } from 'lucide-react';
import type { DocumentSnapshot, DocumentArtifactDto } from '../../shared/types';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { DocumentNode } from './DocumentNode';
import { ArtifactNode } from './ArtifactNode';
import { DocumentContextMenu, type ContextMenuAction } from './DocumentContextMenu';

// ---------------------------------------------------------------------------
// FlatNode — ADR-003 扁平化节点类型
// ---------------------------------------------------------------------------

/** 一级节点：文档 */
export interface DocumentFlatNode {
  type: 'document';
  doc: DocumentSnapshot;
  expanded: boolean;
  artifactCount: number;
}

/** 二级节点：产物 */
export interface ArtifactFlatNode {
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
  /** 右键菜单操作回调 (T2.4.1) */
  onContextMenuAction?: (action: ContextMenuAction, node: FlatNode, doc: DocumentSnapshot) => void;
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
  onContextMenuAction,
  emptyMessage = '暂无文档',
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // 从 store 读取展开状态和产物缓存
  const expandedDocIds = useDocumentStore((s) => s.expandedDocIds);
  const artifactsByDocId = useDocumentStore((s) => s.artifactsByDocId);
  const toggleExpand = useDocumentStore((s) => s.toggleExpand);
  const translationJob = useDocumentStore((s) => s.translationJob);

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

  // 右键菜单操作回调 (T2.4.1)
  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction, node: FlatNode, doc: DocumentSnapshot) => {
      onContextMenuAction?.(action, node, doc);
    },
    [onContextMenuAction],
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
      className="flex-1 overflow-y-auto h-full"
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
                <DocumentContextMenu
                  node={node}
                  doc={node.doc}
                  onAction={handleContextMenuAction}
                >
                  <DocumentNode
                    node={node}
                    isActive={activeDocumentId === node.doc.documentId}
                    onToggle={handleToggle}
                    onClick={handleDocClick}
                    isTranslating={
                      translationJob?.documentId === node.doc.documentId &&
                      (translationJob?.status === 'running' || translationJob?.status === 'queued')
                    }
                  />
                </DocumentContextMenu>
              ) : (
                <DocumentContextMenu
                  node={node}
                  doc={documents.find(d => d.documentId === node.parentDocId) ?? documents[0]}
                  onAction={handleContextMenuAction}
                >
                  <ArtifactNode
                    node={node}
                    onClick={handleArtifactClick}
                  />
                </DocumentContextMenu>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
