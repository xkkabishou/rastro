// =============================================================================
// NotebookLM WebView 自动化核心逻辑
// 任务: T3.1.1 [REQ-006]
// 权威源: frontend-system.md — Challenge H2 (Frontend 自治模块)
// =============================================================================

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** NotebookLM Studio 生成类型（共 9 种） */
export type StudioGenerationType =
  | 'mindmap'
  | 'slides'
  | 'quiz'
  | 'flashcards'
  | 'study-guide'
  | 'timeline'
  | 'briefing-doc'
  | 'faq'
  | 'audio-overview';

/** Studio 生成类型元数据 */
export interface StudioTypeInfo {
  type: StudioGenerationType;
  /** 显示名称（中文） */
  label: string;
  /** 图标名称（对应 Lucide 图标） */
  icon: string;
  /** 简要描述 */
  description: string;
}

/** NotebookLM 自动化状态机 */
export type NotebookLMState =
  | 'idle'             // 初始状态
  | 'loading'          // WebView 加载中
  | 'login-required'   // 需要 Google 登录
  | 'logging-in'       // 正在登录
  | 'ready'            // 已登录，可操作
  | 'uploading'        // 上传 PDF 中
  | 'generating'       // Studio 生成中
  | 'completed'        // 生成完成
  | 'error';           // 错误状态

/** NotebookLM 错误类型 */
export type NotebookLMErrorType =
  | 'WEBVIEW_TIMEOUT'        // WebView 加载超时 (>60s)
  | 'LOGIN_EXPIRED'          // Google 登录过期
  | 'USAGE_LIMIT_REACHED'   // 使用限制
  | 'UPLOAD_FAILED'         // PDF 上传失败
  | 'GENERATION_FAILED'     // Studio 生成失败
  | 'NETWORK_ERROR'         // 网络错误
  | 'UNKNOWN_ERROR';        // 未知错误

/** 错误信息 */
export interface NotebookLMError {
  type: NotebookLMErrorType;
  message: string;
  retryable: boolean;
}

/** 状态上下文 */
export interface NotebookLMContext {
  state: NotebookLMState;
  error: NotebookLMError | null;
  /** 当前生成类型 */
  activeGeneration: StudioGenerationType | null;
  /** 生成进度描述 */
  progressMessage: string | null;
  /** 是否 Google 已登录 */
  isLoggedIn: boolean;
  /** 当前上传的 PDF 路径 */
  currentPdfPath: string | null;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** NotebookLM 首页地址 */
export const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

/** WebView 加载超时时间（毫秒） */
export const WEBVIEW_LOAD_TIMEOUT_MS = 60_000;

/** 操作轮询间隔（毫秒） */
export const POLL_INTERVAL_MS = 2_000;

/** 9 种 Studio 生成类型元数据 */
export const STUDIO_TYPES: StudioTypeInfo[] = [
  { type: 'mindmap',       label: '思维导图',   icon: 'Network',    description: '可视化论文核心概念关系' },
  { type: 'slides',        label: '幻灯片',     icon: 'Presentation', description: '生成论文要点演示文稿' },
  { type: 'quiz',          label: '测验',       icon: 'HelpCircle', description: '基于论文内容生成练习题' },
  { type: 'flashcards',    label: '闪卡',       icon: 'Layers',     description: '制作关键概念记忆卡片' },
  { type: 'study-guide',   label: '学习指南',   icon: 'BookOpen',   description: '生成结构化学习大纲' },
  { type: 'timeline',      label: '时间线',     icon: 'Clock',      description: '提取关键事件时间线' },
  { type: 'briefing-doc',  label: '简报',       icon: 'FileText',   description: '生成论文精简摘要报告' },
  { type: 'faq',           label: '常见问题',   icon: 'MessageCircle', description: '整理常见问题与解答' },
  { type: 'audio-overview', label: '音频概览',  icon: 'Headphones', description: '生成音频形式的概览' },
];

// ---------------------------------------------------------------------------
// 初始状态
// ---------------------------------------------------------------------------

/** 创建初始上下文 */
export function createInitialContext(): NotebookLMContext {
  return {
    state: 'idle',
    error: null,
    activeGeneration: null,
    progressMessage: null,
    isLoggedIn: false,
    currentPdfPath: null,
  };
}

// ---------------------------------------------------------------------------
// WebView 注入脚本
// ---------------------------------------------------------------------------

/**
 * 检测 Google 登录状态
 * 通过检查页面 DOM 判断是否已登录
 */
export function scriptCheckLoginStatus(): string {
  return `
    (function() {
      // 检测页面是否包含 Google 登录入口或已登录标识
      const loginButton = document.querySelector('a[href*="accounts.google.com"]');
      const userAvatar = document.querySelector('img[alt*="Google Account"], header img[src*="googleusercontent"]');
      const isLoggedIn = !loginButton && !!userAvatar;
      return JSON.stringify({ isLoggedIn });
    })();
  `;
}

/**
 * 检测 NotebookLM 页面加载完成
 */
export function scriptCheckPageReady(): string {
  return `
    (function() {
      // 检测核心 UI 元素是否存在
      const mainContent = document.querySelector('main, [role="main"]');
      const isReady = !!mainContent && document.readyState === 'complete';
      return JSON.stringify({ isReady });
    })();
  `;
}

/**
 * 创建新 Notebook
 */
export function scriptCreateNotebook(): string {
  return `
    (function() {
      try {
        // 查找 "New Notebook" 或 "Create" 按钮
        const createBtn = document.querySelector(
          'button[aria-label*="Create"], button[aria-label*="New"], [data-action="create"]'
        );
        if (createBtn) {
          createBtn.click();
          return JSON.stringify({ success: true });
        }
        return JSON.stringify({ success: false, error: 'Create button not found' });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    })();
  `;
}

/**
 * 触发 PDF 文件上传
 * 注入文件到 file input 元素
 */
export function scriptTriggerUpload(): string {
  return `
    (function() {
      try {
        // 查找文件上传入口
        const uploadBtn = document.querySelector(
          'button[aria-label*="Upload"], button[aria-label*="upload"], [data-action="upload"]'
        );
        const fileInput = document.querySelector('input[type="file"]');
        if (uploadBtn) {
          uploadBtn.click();
          return JSON.stringify({ success: true, method: 'button' });
        } else if (fileInput) {
          fileInput.click();
          return JSON.stringify({ success: true, method: 'input' });
        }
        return JSON.stringify({ success: false, error: 'Upload element not found' });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    })();
  `;
}

/**
 * 触发 Studio 中特定生成类型
 */
export function scriptTriggerStudioGeneration(type: StudioGenerationType): string {
  // 各类型对应的英文标签（用于 DOM 匹配）
  const typeLabels: Record<StudioGenerationType, string[]> = {
    'mindmap':       ['Mind map', 'Mindmap'],
    'slides':        ['Slides', 'Presentation'],
    'quiz':          ['Quiz', 'Test'],
    'flashcards':    ['Flashcard', 'Flash card'],
    'study-guide':   ['Study guide', 'Study Guide'],
    'timeline':      ['Timeline'],
    'briefing-doc':  ['Briefing doc', 'Briefing'],
    'faq':           ['FAQ', 'Frequently asked'],
    'audio-overview': ['Audio Overview', 'Deep Dive'],
  };

  const labels = JSON.stringify(typeLabels[type]);

  return `
    (function() {
      try {
        const labels = ${labels};
        // 先尝试进入 Studio 面板
        const studioTab = Array.from(document.querySelectorAll('button, [role="tab"]'))
          .find(el => el.textContent?.includes('Studio') || el.textContent?.includes('Audio'));
        if (studioTab) studioTab.click();

        // 延迟后查找对应类型按钮
        setTimeout(() => {
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
          const targetBtn = allButtons.find(btn => {
            const text = btn.textContent || '';
            return labels.some(l => text.includes(l));
          });
          if (targetBtn) targetBtn.click();
        }, 1000);

        return JSON.stringify({ success: true });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    })();
  `;
}

/**
 * 检测 Studio 生成进度
 */
export function scriptCheckGenerationStatus(): string {
  return `
    (function() {
      try {
        // 检测进度指示器或完成标识
        const spinner = document.querySelector('[role="progressbar"], .loading-indicator, [aria-busy="true"]');
        const result = document.querySelector('.studio-result, [data-result], .generated-content');
        const errorEl = document.querySelector('.error-message, [role="alert"]');

        if (errorEl) {
          return JSON.stringify({ status: 'error', message: errorEl.textContent });
        }
        if (result) {
          return JSON.stringify({ status: 'completed' });
        }
        if (spinner) {
          return JSON.stringify({ status: 'generating' });
        }
        return JSON.stringify({ status: 'unknown' });
      } catch (e) {
        return JSON.stringify({ status: 'error', message: String(e) });
      }
    })();
  `;
}

/**
 * 检测是否达到使用限制
 */
export function scriptCheckUsageLimit(): string {
  return `
    (function() {
      const body = document.body?.textContent || '';
      const limitReached = body.includes('limit') && (body.includes('reached') || body.includes('exceeded'));
      const quotaError = body.includes('quota') || body.includes('too many');
      return JSON.stringify({ limitReached: limitReached || quotaError });
    })();
  `;
}

// ---------------------------------------------------------------------------
// 错误信息映射
// ---------------------------------------------------------------------------

/** 根据错误类型获取用户友好的中文提示 */
export function getErrorMessage(errorType: NotebookLMErrorType): NotebookLMError {
  const errorMap: Record<NotebookLMErrorType, NotebookLMError> = {
    WEBVIEW_TIMEOUT: {
      type: 'WEBVIEW_TIMEOUT',
      message: 'NotebookLM 连接失败，请检查网络连接后重试。',
      retryable: true,
    },
    LOGIN_EXPIRED: {
      type: 'LOGIN_EXPIRED',
      message: 'Google 登录已过期，请重新登录。',
      retryable: true,
    },
    USAGE_LIMIT_REACHED: {
      type: 'USAGE_LIMIT_REACHED',
      message: 'NotebookLM 已达到使用上限，请稍后再试。',
      retryable: false,
    },
    UPLOAD_FAILED: {
      type: 'UPLOAD_FAILED',
      message: 'PDF 上传失败，请确认文件完整后重试。',
      retryable: true,
    },
    GENERATION_FAILED: {
      type: 'GENERATION_FAILED',
      message: 'Studio 生成失败，请重试或更换生成类型。',
      retryable: true,
    },
    NETWORK_ERROR: {
      type: 'NETWORK_ERROR',
      message: '网络连接中断，请检查网络后重试。',
      retryable: true,
    },
    UNKNOWN_ERROR: {
      type: 'UNKNOWN_ERROR',
      message: '发生未知错误，请重试。',
      retryable: true,
    },
  };
  return errorMap[errorType];
}
