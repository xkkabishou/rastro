import React, { useState, useCallback, useEffect } from 'react';
import { FileText, RotateCcw, Save, Check, MessageSquareText, AlertTriangle } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import type { CustomPromptDto, PromptKey } from '../../shared/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface PromptEditorProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  promptKey: PromptKey;
}

// ---------------------------------------------------------------------------
// PromptEditor — 单个提示词编辑区域
// ---------------------------------------------------------------------------

const PromptEditor: React.FC<PromptEditorProps> = ({
  title,
  description,
  icon,
  promptKey,
}) => {
  const [promptDto, setPromptDto] = useState<CustomPromptDto | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // a11y: 为每个编辑器生成唯一 ID
  const textareaId = `prompt-textarea-${promptKey}`;
  const descriptionId = `prompt-desc-${promptKey}`;
  const statusId = `prompt-status-${promptKey}`;

  // 获取当前已保存的内容（考虑空字符串也是有效自定义内容）
  const getSavedContent = useCallback((dto: CustomPromptDto): string => {
    if (dto.isCustom && dto.content !== null) {
      return dto.content;
    }
    return dto.defaultContent;
  }, []);

  // 是否有未保存的修改
  const isDirty = promptDto ? editValue !== getSavedContent(promptDto) : false;

  // 加载提示词
  const loadPrompt = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const dto = await ipcClient.getCustomPrompt(promptKey);
      setPromptDto(dto);
      setEditValue(getSavedContent(dto));
    } catch (err) {
      console.error(`加载提示词失败 (${promptKey}):`, err);
      setLoadError('加载提示词失败，请检查后端是否正常运行。');
    } finally {
      setIsLoading(false);
    }
  }, [promptKey, getSavedContent]);

  useEffect(() => {
    void loadPrompt();
  }, [loadPrompt]);

  // 保存（禁止保存空白内容）
  const handleSave = useCallback(async () => {
    if (!editValue.trim()) return;
    setIsSaving(true);
    setSaveResult(null);
    try {
      const dto = await ipcClient.saveCustomPrompt(promptKey, editValue);
      setPromptDto(dto);
      setSaveResult('success');
      setTimeout(() => setSaveResult(null), 2000);
    } catch (err) {
      console.error(`保存提示词失败 (${promptKey}):`, err);
      setSaveResult('error');
      setTimeout(() => setSaveResult(null), 3000);
    } finally {
      setIsSaving(false);
    }
  }, [promptKey, editValue]);

  // 恢复默认
  const handleReset = useCallback(async () => {
    try {
      await ipcClient.resetCustomPrompt(promptKey);
      await loadPrompt();
      setSaveResult(null);
    } catch (err) {
      console.error(`重置提示词失败 (${promptKey}):`, err);
    }
  }, [promptKey, loadPrompt]);

  // 加载中
  if (isLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
        <div className="apple-card p-6 text-center text-xs text-[var(--color-text-quaternary)]">
          加载中...
        </div>
      </div>
    );
  }

  // 加载失败
  if (loadError) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
        <div className="apple-card p-3 flex items-start gap-2 border-l-2 border-[var(--color-warning)]">
          <AlertTriangle size={14} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-[var(--color-text-secondary)]">{loadError}</p>
            <button
              onClick={loadPrompt}
              className="mt-2 text-[11px] text-[var(--color-primary)] hover:underline"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* 区域标题 */}
      <h3 className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
        <label htmlFor={textareaId} className="flex items-center gap-1.5 cursor-pointer">
          {icon}
          {title}
        </label>
      </h3>

      <div className="apple-card p-4 space-y-3">
        {/* 说明文字 + 自定义标记 */}
        <div className="flex items-center justify-between">
          <p id={descriptionId} className="text-[11px] text-[var(--color-text-tertiary)] leading-relaxed flex-1">
            {description}
          </p>
          {promptDto?.isCustom ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-medium shrink-0 ml-2">
              已自定义
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-quaternary)] font-medium shrink-0 ml-2">
              默认
            </span>
          )}
        </div>

        {/* 提示词编辑区 */}
        <textarea
          id={textareaId}
          aria-describedby={descriptionId}
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            setSaveResult(null);
          }}
          className="input-base w-full text-xs leading-relaxed resize-y font-mono"
          style={{ minHeight: 160, maxHeight: 280 }}
          placeholder="输入自定义提示词..."
        />

        {/* 字符计数 */}
        <div className="text-right">
          <span className={`text-[10px] ${editValue.length > 2000 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-quaternary)]'}`}>
            {editValue.length} 字符
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={!promptDto?.isCustom && !isDirty}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw size={12} />
            恢复默认
          </button>

          <div className="flex items-center gap-2">
            <span id={statusId} aria-live="polite" className="text-[11px] flex items-center gap-1">
              {saveResult === 'success' && (
                <span className="text-[var(--color-success)] flex items-center gap-1">
                  <Check size={12} />
                  已保存
                </span>
              )}
              {saveResult === 'error' && (
                <span className="text-[var(--color-destructive)]">
                  保存失败
                </span>
              )}
            </span>
            <button
              onClick={handleSave}
              disabled={isSaving || !isDirty || !editValue.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Save size={12} />
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// PromptSettings 主组件
// ---------------------------------------------------------------------------

export const PromptSettings: React.FC = () => (
  <div className="space-y-6">
    <PromptEditor
      title="全文翻译提示词"
      description="用于指导 LLM 翻译 PDF 全文的系统提示词"
      icon={<FileText size={12} />}
      promptKey="translation"
    />

    <PromptEditor
      title="AI 总结提示词"
      description="用于指导 LLM 生成文献结构化摘要的系统提示词"
      icon={<MessageSquareText size={12} />}
      promptKey="summary"
    />
  </div>
);
