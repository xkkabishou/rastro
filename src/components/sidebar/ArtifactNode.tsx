import React from 'react';
import { Loader2 } from 'lucide-react';
import type { DocumentArtifactDto } from '../../shared/types';
import type { ArtifactFlatNode } from './DocumentTree';

// ---------------------------------------------------------------------------
// 产物 icon 映射
// ---------------------------------------------------------------------------

/** 根据产物 kind 返回对应的 emoji icon */
export function artifactIcon(kind: string): string {
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
// 工具函数
// ---------------------------------------------------------------------------

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ArtifactNodeProps {
  /** 扁平化后的产物节点 */
  node: ArtifactFlatNode;
  /** 点击产物回调 */
  onClick: (artifact: DocumentArtifactDto, parentDocId: string) => void;
}

// ---------------------------------------------------------------------------
// ArtifactNode 组件
// ---------------------------------------------------------------------------

/**
 * 产物二级节点
 * T2.2.3 [REQ-010]
 *
 * 渲染产物 icon + 名称 + 元信息（provider/日期/大小），
 * 按 kind 显示不同 icon，点击触发对应操作。
 */
export const ArtifactNode: React.FC<ArtifactNodeProps> = React.memo(
  ({ node, onClick }) => {
    const { artifact, parentDocId } = node;
    // 占位：将来可用于产物加载状态
    const isLoading = false;

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
  },
);
ArtifactNode.displayName = 'ArtifactNode';
