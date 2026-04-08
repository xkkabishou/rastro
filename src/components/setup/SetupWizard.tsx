import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, AlertTriangle, CheckCircle2, Terminal,
  Copy, Check, Loader2, RefreshCw, Download,
} from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import type { AppError, AppErrorCode } from '../../shared/types';
import shibaErrorUrl from '../../assets/shiba/shiba-error.png';
import shibaSuccessUrl from '../../assets/shiba/shiba-success.png';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** Python 环境错误码（Challenge H4） */
type PythonSetupErrorCode =
  | 'PYTHON_NOT_FOUND'
  | 'PYTHON_VERSION_MISMATCH'
  | 'PDFMATHTRANSLATE_NOT_INSTALLED';

/** 引导步骤 */
interface SetupStep {
  /** 步骤标题 */
  title: string;
  /** 步骤描述 */
  description: string;
  /** 安装命令 */
  command: string;
  /** 图标类型 */
  icon: 'download' | 'terminal';
}

/** 环境状态 */
type SetupState = 'checking' | 'error' | 'resolved';

// ---------------------------------------------------------------------------
// 错误码 → 引导步骤映射
// ---------------------------------------------------------------------------

const ERROR_STEP_MAP: Record<PythonSetupErrorCode, SetupStep[]> = {
  PYTHON_NOT_FOUND: [
    {
      title: '安装 Python 3.12',
      description: '翻译功能需要 Python 3.12 或更高版本。推荐使用 Homebrew 安装：',
      command: 'brew install python@3.12',
      icon: 'download',
    },
    {
      title: '验证安装',
      description: '安装完成后，验证 Python 版本：',
      command: 'python3 --version',
      icon: 'terminal',
    },
  ],
  PYTHON_VERSION_MISMATCH: [
    {
      title: '升级 Python 版本',
      description: '当前 Python 版本过低，翻译功能需要 Python 3.12 或更高版本：',
      command: 'brew upgrade python@3.12',
      icon: 'download',
    },
    {
      title: '验证版本',
      description: '升级完成后，确认版本号 ≥ 3.12：',
      command: 'python3 --version',
      icon: 'terminal',
    },
  ],
  PDFMATHTRANSLATE_NOT_INSTALLED: [
    {
      title: '创建虚拟环境并安装依赖',
      description: '翻译引擎需要 BabelDOC 和相关依赖。在项目目录下执行：',
      command: 'python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt',
      icon: 'download',
    },
    {
      title: '验证安装',
      description: '安装完成后，验证 BabelDOC 可用：',
      command: '.venv/bin/python3 -c "import babeldoc; print(babeldoc.__version__)"',
      icon: 'terminal',
    },
  ],
};

/** 错误码 → 标题 */
const ERROR_TITLE_MAP: Record<PythonSetupErrorCode, string> = {
  PYTHON_NOT_FOUND: '未检测到 Python',
  PYTHON_VERSION_MISMATCH: 'Python 版本不兼容',
  PDFMATHTRANSLATE_NOT_INSTALLED: '翻译引擎未安装',
};

/** 错误码 → 描述 */
const ERROR_DESC_MAP: Record<PythonSetupErrorCode, string> = {
  PYTHON_NOT_FOUND: 'PDF 翻译功能需要 Python 运行环境。请按照以下步骤安装。',
  PYTHON_VERSION_MISMATCH: '当前 Python 版本不满足要求（需要 3.12+）。请升级后重试。',
  PDFMATHTRANSLATE_NOT_INSTALLED: '翻译引擎依赖尚未安装。请按以下步骤安装。',
};

// ---------------------------------------------------------------------------
// 判断是否为 Python 环境错误
// ---------------------------------------------------------------------------

const PYTHON_ERROR_CODES: Set<string> = new Set([
  'PYTHON_NOT_FOUND',
  'PYTHON_VERSION_MISMATCH',
  'PDFMATHTRANSLATE_NOT_INSTALLED',
]);

/** 检查错误是否为 Python 环境问题 */
export function isPythonSetupError(error: AppError): boolean {
  return PYTHON_ERROR_CODES.has(error.code);
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

interface SetupWizardProps {
  /** 触发此 Dialog 的错误 */
  error: AppError;
  /** 是否可见 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 环境修复成功回调 */
  onResolved?: () => void;
}

/**
 * Python 环境引导组件
 * T4.1.5 (Challenge H4)
 *
 * 当翻译功能检测到 Python 环境问题时弹出 Dialog，
 * 引导用户安装/升级 Python 和 PDFMathTranslate
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({
  error,
  isOpen,
  onClose,
  onResolved,
}) => {
  const [setupState, setSetupState] = useState<SetupState>('error');
  const [isChecking, setIsChecking] = useState(false);

  const errorCode = error.code as PythonSetupErrorCode;
  const steps = ERROR_STEP_MAP[errorCode] ?? [];
  const title = ERROR_TITLE_MAP[errorCode] ?? '环境配置';
  const description = ERROR_DESC_MAP[errorCode] ?? error.message;

  // 重新检测 Python 环境
  const handleRecheck = useCallback(async () => {
    try {
      setIsChecking(true);
      setSetupState('checking');
      await ipcClient.ensureTranslationEngine();
      // 如果没有抛出错误，说明环境已修复
      setSetupState('resolved');
      onResolved?.();
    } catch (err) {
      const appError = err as AppError;
      if (isPythonSetupError(appError)) {
        // 仍然是 Python 环境错误
        setSetupState('error');
      } else {
        // 非 Python 错误，说明 Python 环境已修复
        setSetupState('resolved');
        onResolved?.();
      }
    } finally {
      setIsChecking(false);
    }
  }, [onResolved]);

  // 打开时重置状态
  useEffect(() => {
    if (isOpen) {
      setSetupState('error');
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-md apple-card overflow-hidden shadow-[var(--shadow-overlay)]">
              {/* 头部 */}
              <div className="flex items-start justify-between p-5 pb-0">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
                    <img
                      src={setupState === 'resolved' ? shibaSuccessUrl : shibaErrorUrl}
                      alt=""
                      className="w-10 h-10 object-contain"
                    />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--color-text)]">
                      {setupState === 'resolved' ? '环境就绪' : title}
                    </h2>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-relaxed">
                      {setupState === 'resolved'
                        ? 'Python 环境和翻译引擎已正确配置，可以开始使用翻译功能了。'
                        : description}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 步骤列表 */}
              {setupState !== 'resolved' && steps.length > 0 && (
                <div className="px-5 py-4 space-y-3">
                  {steps.map((step, index) => (
                    <StepCard key={index} step={step} index={index + 1} />
                  ))}
                </div>
              )}

              {/* 底部操作栏 */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                {setupState === 'resolved' ? (
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)] transition-colors"
                  >
                    开始翻译
                  </button>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors"
                    >
                      稍后
                    </button>
                    <button
                      onClick={handleRecheck}
                      disabled={isChecking}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors"
                    >
                      {isChecking ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          检测中...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={12} />
                          重新检测
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

/** 安装步骤卡片 */
const StepCard: React.FC<{ step: SetupStep; index: number }> = ({ step, index }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(step.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板 API 不可用时忽略
    }
  }, [step.command]);

  return (
    <div className="apple-card p-3.5">
      <div className="flex items-start gap-2.5">
        {/* 步骤编号 */}
        <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] flex items-center justify-center shrink-0 text-[10px] font-bold">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--color-text)] mb-1">{step.title}</p>
          <p className="text-[10px] text-[var(--color-text-tertiary)] leading-relaxed mb-2">
            {step.description}
          </p>
          {/* 命令行 */}
          <div className="flex items-center gap-1.5 bg-[var(--color-code-bg)] rounded-lg px-3 py-2 group">
            <Terminal size={12} className="text-[var(--color-text-quaternary)] shrink-0" />
            <code className="text-xs font-mono text-[var(--color-code-text)] flex-1 select-all">
              {step.command}
            </code>
            <button
              onClick={handleCopy}
              className="p-1 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-quaternary)] hover:text-[var(--color-text-secondary)] transition-colors opacity-0 group-hover:opacity-100"
              title="复制命令"
            >
              {copied ? (
                <Check size={12} className="text-[var(--color-success)]" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
