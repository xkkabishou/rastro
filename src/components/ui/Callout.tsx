// ---------------------------------------------------------------------------
// Obsidian Flavored Callout 渲染组件
//
// 识别 `> [!info] 标题\n> 内容...` 形式的 Obsidian Callout 语法，
// 并渲染为带图标 + 颜色主题的块状视图。风格参考 Obsidian 默认 Callout，
// 配色遵循 Shiba Warm Palette。
//
// 使用方式：作为 react-markdown 的自定义 components.blockquote 覆盖器。
// 详见 SummaryPanel.tsx / ChatMessage.tsx。
// ---------------------------------------------------------------------------

import React, { type ReactNode } from 'react';
import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  FileText,
  FlaskConical,
  HelpCircle,
  Info,
  Lightbulb,
  Quote,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface CalloutStyle {
  /** lucide-react 图标组件 */
  icon: LucideIcon;
  /** 默认中文标题（当用户未自定义时使用） */
  defaultTitle: string;
  /** 主色：用于图标 + 标题 + 左侧竖条 */
  accentColor: string;
  /** 背景色：整个 callout 的浅色底 */
  backgroundColor: string;
  /** 边框色：callout 外框 */
  borderColor: string;
}

// ---------------------------------------------------------------------------
// Callout 类型 → 样式映射
//
// 采用 Shiba Warm Palette 为基调，按语义赋予不同色相：
// - info / tip / example: 琥珀金主色系
// - note / todo: 暖黄
// - warning: 橙红
// - danger / error: 深红
// - question: 紫色
// - success: 绿色
// - abstract / quote: 蓝灰 / 暖灰
// ---------------------------------------------------------------------------

const CALLOUT_STYLES: Record<string, CalloutStyle> = {
  // 摘要类
  abstract: {
    icon: FileText,
    defaultTitle: '摘要',
    accentColor: '#5A7FA9',
    backgroundColor: 'rgba(90, 127, 169, 0.08)',
    borderColor: 'rgba(90, 127, 169, 0.25)',
  },
  summary: {
    icon: FileText,
    defaultTitle: '摘要',
    accentColor: '#5A7FA9',
    backgroundColor: 'rgba(90, 127, 169, 0.08)',
    borderColor: 'rgba(90, 127, 169, 0.25)',
  },
  tldr: {
    icon: FileText,
    defaultTitle: 'TL;DR',
    accentColor: '#5A7FA9',
    backgroundColor: 'rgba(90, 127, 169, 0.08)',
    borderColor: 'rgba(90, 127, 169, 0.25)',
  },
  // 说明类（琥珀金主色）
  info: {
    icon: Info,
    defaultTitle: '说明',
    accentColor: '#D4924A',
    backgroundColor: 'rgba(212, 146, 74, 0.08)',
    borderColor: 'rgba(212, 146, 74, 0.25)',
  },
  // 笔记类（暖黄）
  note: {
    icon: StickyNote,
    defaultTitle: '笔记',
    accentColor: '#B8823E',
    backgroundColor: 'rgba(184, 130, 62, 0.08)',
    borderColor: 'rgba(184, 130, 62, 0.25)',
  },
  // 提示类（琥珀金 + 灯泡图标）
  tip: {
    icon: Lightbulb,
    defaultTitle: '提示',
    accentColor: '#E8973E',
    backgroundColor: 'rgba(232, 151, 62, 0.08)',
    borderColor: 'rgba(232, 151, 62, 0.25)',
  },
  hint: {
    icon: Lightbulb,
    defaultTitle: '提示',
    accentColor: '#E8973E',
    backgroundColor: 'rgba(232, 151, 62, 0.08)',
    borderColor: 'rgba(232, 151, 62, 0.25)',
  },
  important: {
    icon: Lightbulb,
    defaultTitle: '重要',
    accentColor: '#E8973E',
    backgroundColor: 'rgba(232, 151, 62, 0.08)',
    borderColor: 'rgba(232, 151, 62, 0.25)',
  },
  // 警告类（橙红）
  warning: {
    icon: AlertTriangle,
    defaultTitle: '注意',
    accentColor: '#D96E3F',
    backgroundColor: 'rgba(217, 110, 63, 0.08)',
    borderColor: 'rgba(217, 110, 63, 0.28)',
  },
  caution: {
    icon: AlertTriangle,
    defaultTitle: '警示',
    accentColor: '#D96E3F',
    backgroundColor: 'rgba(217, 110, 63, 0.08)',
    borderColor: 'rgba(217, 110, 63, 0.28)',
  },
  attention: {
    icon: AlertTriangle,
    defaultTitle: '注意',
    accentColor: '#D96E3F',
    backgroundColor: 'rgba(217, 110, 63, 0.08)',
    borderColor: 'rgba(217, 110, 63, 0.28)',
  },
  // 危险类（深红）
  danger: {
    icon: CircleAlert,
    defaultTitle: '危险',
    accentColor: '#C04444',
    backgroundColor: 'rgba(192, 68, 68, 0.08)',
    borderColor: 'rgba(192, 68, 68, 0.28)',
  },
  error: {
    icon: CircleAlert,
    defaultTitle: '错误',
    accentColor: '#C04444',
    backgroundColor: 'rgba(192, 68, 68, 0.08)',
    borderColor: 'rgba(192, 68, 68, 0.28)',
  },
  bug: {
    icon: CircleAlert,
    defaultTitle: 'Bug',
    accentColor: '#C04444',
    backgroundColor: 'rgba(192, 68, 68, 0.08)',
    borderColor: 'rgba(192, 68, 68, 0.28)',
  },
  failure: {
    icon: CircleAlert,
    defaultTitle: '失败',
    accentColor: '#C04444',
    backgroundColor: 'rgba(192, 68, 68, 0.08)',
    borderColor: 'rgba(192, 68, 68, 0.28)',
  },
  fail: {
    icon: CircleAlert,
    defaultTitle: '失败',
    accentColor: '#C04444',
    backgroundColor: 'rgba(192, 68, 68, 0.08)',
    borderColor: 'rgba(192, 68, 68, 0.28)',
  },
  missing: {
    icon: CircleAlert,
    defaultTitle: '缺失',
    accentColor: '#C04444',
    backgroundColor: 'rgba(192, 68, 68, 0.08)',
    borderColor: 'rgba(192, 68, 68, 0.28)',
  },
  // 问题类（紫色）
  question: {
    icon: HelpCircle,
    defaultTitle: '问题',
    accentColor: '#8A6AB8',
    backgroundColor: 'rgba(138, 106, 184, 0.08)',
    borderColor: 'rgba(138, 106, 184, 0.25)',
  },
  help: {
    icon: HelpCircle,
    defaultTitle: '帮助',
    accentColor: '#8A6AB8',
    backgroundColor: 'rgba(138, 106, 184, 0.08)',
    borderColor: 'rgba(138, 106, 184, 0.25)',
  },
  faq: {
    icon: HelpCircle,
    defaultTitle: '常见问题',
    accentColor: '#8A6AB8',
    backgroundColor: 'rgba(138, 106, 184, 0.08)',
    borderColor: 'rgba(138, 106, 184, 0.25)',
  },
  // 成功类（绿色）
  success: {
    icon: CircleCheck,
    defaultTitle: '成功',
    accentColor: '#5A9E6F',
    backgroundColor: 'rgba(90, 158, 111, 0.08)',
    borderColor: 'rgba(90, 158, 111, 0.25)',
  },
  check: {
    icon: CircleCheck,
    defaultTitle: '检查',
    accentColor: '#5A9E6F',
    backgroundColor: 'rgba(90, 158, 111, 0.08)',
    borderColor: 'rgba(90, 158, 111, 0.25)',
  },
  done: {
    icon: CircleCheck,
    defaultTitle: '完成',
    accentColor: '#5A9E6F',
    backgroundColor: 'rgba(90, 158, 111, 0.08)',
    borderColor: 'rgba(90, 158, 111, 0.25)',
  },
  // 示例类
  example: {
    icon: FlaskConical,
    defaultTitle: '示例',
    accentColor: '#C07E3A',
    backgroundColor: 'rgba(192, 126, 58, 0.08)',
    borderColor: 'rgba(192, 126, 58, 0.25)',
  },
  // 引用类（暖灰）
  quote: {
    icon: Quote,
    defaultTitle: '引述',
    accentColor: '#8A7560',
    backgroundColor: 'rgba(138, 117, 96, 0.08)',
    borderColor: 'rgba(138, 117, 96, 0.25)',
  },
  cite: {
    icon: Quote,
    defaultTitle: '引用',
    accentColor: '#8A7560',
    backgroundColor: 'rgba(138, 117, 96, 0.08)',
    borderColor: 'rgba(138, 117, 96, 0.25)',
  },
  // 待办类
  todo: {
    icon: CircleDot,
    defaultTitle: '待办',
    accentColor: '#B8823E',
    backgroundColor: 'rgba(184, 130, 62, 0.08)',
    borderColor: 'rgba(184, 130, 62, 0.25)',
  },
};

// ---------------------------------------------------------------------------
// 解析工具：从 blockquote 的子节点中提取 [!type] 和可选标题
// ---------------------------------------------------------------------------

const CALLOUT_PATTERN = /^\[!(\w+)\]\s*(.*)$/;

interface ParsedCallout {
  type: string;
  title: string;
}

/**
 * 从 react-markdown 传入的 children 的第一段文本中解析 Callout 头部。
 *
 * react-markdown 渲染 blockquote 时，children 通常是一个或多个 <p> 元素。
 * 第一个 <p> 的 children 是一串字符串或节点数组。我们尝试取出它的纯文本前缀，
 * 判断是否匹配 `[!type] title` 模式。
 *
 * 返回 null 表示不是 Obsidian Callout，应走默认 blockquote 渲染。
 */
function parseCalloutHeader(firstLineText: string): ParsedCallout | null {
  const match = firstLineText.match(CALLOUT_PATTERN);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (!(type in CALLOUT_STYLES)) return null;
  return { type, title: (match[2] ?? '').trim() };
}

/**
 * 获取一个 React 节点的首行纯文本（用于匹配 Callout 头部）。
 * 仅遍历到首个字符串节点或首个换行前的文本。
 */
function getLeadingText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') {
    const s = String(node);
    const nl = s.indexOf('\n');
    return nl >= 0 ? s.slice(0, nl) : s;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const text = getLeadingText(child);
      if (text.length > 0) return text;
    }
    return '';
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return getLeadingText(props.children);
  }
  return '';
}

/**
 * 递归地在 React 节点树中，删除首行文本中匹配 `[!type] title` 的前缀部分。
 * 用于在渲染 callout 内容时，去掉第一段里被用作头部的 `[!info] 标题` 文字。
 */
function stripCalloutHeaderFromFirstText(node: ReactNode): ReactNode {
  if (node == null || typeof node === 'boolean') return node;
  if (typeof node === 'string') {
    const nl = node.indexOf('\n');
    const head = nl >= 0 ? node.slice(0, nl) : node;
    const tail = nl >= 0 ? node.slice(nl) : '';
    const stripped = head.replace(CALLOUT_PATTERN, '').trimStart();
    return stripped + tail;
  }
  if (typeof node === 'number') return node;
  if (Array.isArray(node)) {
    const result: ReactNode[] = [];
    let replaced = false;
    for (const child of node) {
      if (!replaced) {
        const leading = getLeadingText(child);
        if (leading.length > 0) {
          result.push(stripCalloutHeaderFromFirstText(child));
          replaced = true;
          continue;
        }
      }
      result.push(child);
    }
    return result;
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    const children = stripCalloutHeaderFromFirstText(props.children);
    return React.cloneElement(node, { ...(node.props as object) }, children);
  }
  return node;
}

// ---------------------------------------------------------------------------
// 多 callout 拆分工具
//
// 当 react-markdown 把多个相邻的 `> [!xxx]` blockquote 合并为同一个
// <blockquote> 时，children 里会出现多个以 `[!xxx]` 开头的段落。
// 本函数把 children 的直接子节点数组扫描一遍，按段落级别切分成多个
// "Callout 组"，每组作为独立的 Callout 渲染。
// ---------------------------------------------------------------------------

/** 把任意 children 归一化为直接子节点数组 */
function toChildArray(children: ReactNode): ReactNode[] {
  if (children == null || typeof children === 'boolean') return [];
  if (Array.isArray(children)) return children.filter((c) => c != null && c !== false);
  return [children];
}

/**
 * 判断一个节点是否是以 `[!xxx]` 开头的段落，返回该段落的 callout type。
 * 仅当节点本身是一个段落级元素（如 <p>）且其首个子节点是匹配的文本时才返回。
 */
function getParagraphCalloutType(node: ReactNode): string | null {
  if (node == null || typeof node === 'boolean') return null;
  const leading = getLeadingText(node).trim();
  const parsed = parseCalloutHeader(leading);
  return parsed ? parsed.type : null;
}

/**
 * 把 children 的直接子节点数组按"段落级 callout 起始"切分成多个分组。
 *
 * 例如输入 [<p>[!info] A</p>, <p>内容</p>, <p>[!info] B</p>] 会被切成：
 *   [
 *     [<p>[!info] A</p>, <p>内容</p>],
 *     [<p>[!info] B</p>]
 *   ]
 *
 * 如果 children 只有 0 个或 1 个 callout 起点，返回长度 <= 1 的分组。
 */
function splitChildrenIntoCalloutGroups(children: ReactNode): ReactNode[][] {
  const items = toChildArray(children);
  const groups: ReactNode[][] = [];
  let current: ReactNode[] = [];
  let hasCalloutStart = false;

  for (const item of items) {
    const type = getParagraphCalloutType(item);
    if (type && hasCalloutStart) {
      // 遇到下一个 callout 起始，切出当前组
      if (current.length > 0) groups.push(current);
      current = [item];
    } else {
      if (type) hasCalloutStart = true;
      current.push(item);
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

interface CalloutBlockquoteProps {
  children?: ReactNode;
}

/**
 * 渲染单个 Callout（假定 content 是一个已经确定类型的 callout 段落组）。
 * 内部使用，不直接作为 react-markdown 的 blockquote 覆盖。
 */
const SingleCallout: React.FC<{ content: ReactNode }> = ({ content }) => {
  const firstLine = getLeadingText(content);
  const parsed = parseCalloutHeader(firstLine.trim());

  if (!parsed) {
    // 非 Obsidian callout，走默认 blockquote 样式
    return <blockquote>{content}</blockquote>;
  }

  const style = CALLOUT_STYLES[parsed.type];
  const Icon = style.icon;
  const displayTitle = parsed.title || style.defaultTitle;
  const bodyContent = stripCalloutHeaderFromFirstText(content);

  return (
    <div
      className="obsidian-callout my-3 rounded-lg overflow-hidden"
      style={{
        backgroundColor: style.backgroundColor,
        border: `1px solid ${style.borderColor}`,
        borderLeft: `3px solid ${style.accentColor}`,
      }}
    >
      {/* 头部：图标 + 标题 */}
      <div
        className="flex items-center gap-2 px-3 py-2 font-semibold text-sm"
        style={{ color: style.accentColor }}
      >
        <Icon size={16} strokeWidth={2.25} />
        <span>{displayTitle}</span>
      </div>
      {/* 内容区 */}
      <div
        className="px-3 pb-3 text-sm leading-relaxed"
        style={{ color: 'var(--color-text)' }}
      >
        {bodyContent}
      </div>
    </div>
  );
};

/**
 * react-markdown 自定义 blockquote 组件：
 *
 * - 若 children 中包含多个以 `[!xxx]` 开头的段落（说明 Markdown parser
 *   把多个相邻的 Obsidian callout 合并到了同一个 blockquote），则按段
 *   落级别拆分，依次渲染为独立的 Callout。
 * - 若只有单个 callout，则直接渲染。
 * - 若不是 Obsidian callout，则降级为普通 blockquote。
 */
export const CalloutBlockquote: React.FC<CalloutBlockquoteProps> = ({ children }) => {
  const groups = splitChildrenIntoCalloutGroups(children);

  // 多个 callout：依次渲染
  if (groups.length >= 2) {
    return (
      <>
        {groups.map((group, idx) => (
          <SingleCallout
            key={idx}
            content={group.length === 1 ? group[0] : group}
          />
        ))}
      </>
    );
  }

  // 单个 callout 或非 callout：直接渲染
  return <SingleCallout content={children} />;
};
