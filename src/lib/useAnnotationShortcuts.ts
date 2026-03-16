import { useEffect } from 'react';
import { useAnnotationStore } from '../stores/useAnnotationStore';
import type { AnnotationColor } from '../shared/types';

// ---------------------------------------------------------------------------
// 标注快捷键 Hook
// ---------------------------------------------------------------------------

const COLOR_MAP: Record<string, AnnotationColor> = {
  '1': 'yellow',
  '2': 'red',
  '3': 'green',
  '4': 'blue',
  '5': 'purple',
  '6': 'magenta',
  '7': 'orange',
  '8': 'gray',
};

/**
 * 标注快捷键系统
 * - Cmd+Shift+H → 高亮工具
 * - Cmd+Shift+U → 下划线工具
 * - Cmd+Shift+N → 笔记工具
 * - 1~8 → 切换颜色（仅工具激活时）
 * - Escape → 退出工具
 */
export function useAnnotationShortcuts() {
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const stopEditingNote = useAnnotationStore((s) => s.stopEditingNote);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // 在输入框内不触发快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      // Cmd+Shift+H → 高亮
      if (isMeta && isShift && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setActiveTool(activeTool === 'highlight' ? null : 'highlight');
        return;
      }

      // Cmd+Shift+U → 下划线
      if (isMeta && isShift && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        setActiveTool(activeTool === 'underline' ? null : 'underline');
        return;
      }

      // Cmd+Shift+N → 笔记
      if (isMeta && isShift && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveTool(activeTool === 'note' ? null : 'note');
        return;
      }

      // Escape → 退出工具 / 关闭编辑
      if (e.key === 'Escape') {
        if (activeTool) {
          e.preventDefault();
          setActiveTool(null);
        }
        stopEditingNote();
        return;
      }

      // 1~8 → 切换颜色（工具激活时）
      if (activeTool && !isMeta && !isShift && COLOR_MAP[e.key]) {
        e.preventDefault();
        setActiveColor(COLOR_MAP[e.key]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, setActiveTool, setActiveColor, stopEditingNote]);
}
