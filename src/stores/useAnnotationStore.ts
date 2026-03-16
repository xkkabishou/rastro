import { create } from 'zustand';
import type {
  AnnotationType,
  AnnotationColor,
  AnnotationDto,
  SaveAnnotationInput,
  UpdateAnnotationInput,
} from '../shared/types';
import { ipcClient } from '../lib/ipc-client';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface AnnotationState {
  // 竞态控制
  currentDocumentId: string | null;
  loadRevision: number;

  // 工具状态
  activeTool: AnnotationType | null;
  activeColor: AnnotationColor;

  // 当前文档标注数据
  annotations: AnnotationDto[];
  annotationsByPage: Map<number, AnnotationDto[]>;

  // 编辑状态
  editingAnnotationId: string | null;
  selectedAnnotationId: string | null;
  /** 笔记弹窗锚点：末尾右下角 + 首处右上角（viewport 坐标） */
  notePopupAnchor: { endX: number; endY: number; startX: number; startY: number } | null;

  // Actions — 工具
  setActiveTool: (tool: AnnotationType | null) => void;
  setActiveColor: (color: AnnotationColor) => void;

  // Actions — 数据 CRUD
  loadAnnotations: (documentId: string) => Promise<void>;
  createAnnotation: (input: SaveAnnotationInput) => Promise<AnnotationDto | null>;
  updateAnnotation: (input: UpdateAnnotationInput) => Promise<void>;
  deleteAnnotation: (annotationId: string) => Promise<void>;

  // Actions — 选择与编辑
  selectAnnotation: (id: string | null) => void;
  startEditingNote: (id: string, anchor?: { endX: number; endY: number; startX: number; startY: number }) => void;
  stopEditingNote: () => void;

  // Actions — 清理
  reset: () => void;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function buildPageMap(annotations: AnnotationDto[]): Map<number, AnnotationDto[]> {
  const map = new Map<number, AnnotationDto[]>();
  for (const ann of annotations) {
    const existing = map.get(ann.pageNumber);
    if (existing) {
      existing.push(ann);
    } else {
      map.set(ann.pageNumber, [ann]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState = {
  currentDocumentId: null as string | null,
  loadRevision: 0,
  activeTool: null as AnnotationType | null,
  activeColor: 'yellow' as AnnotationColor,
  annotations: [] as AnnotationDto[],
  annotationsByPage: new Map<number, AnnotationDto[]>(),
  editingAnnotationId: null as string | null,
  selectedAnnotationId: null as string | null,
  notePopupAnchor: null as { endX: number; endY: number; startX: number; startY: number } | null,
};

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  ...initialState,

  setActiveTool: (tool) => {
    set({ activeTool: tool });
  },

  setActiveColor: (color) => {
    set({ activeColor: color });
  },

  // -- 数据 CRUD（含竞态保护） --

  loadAnnotations: async (documentId) => {
    const loadRevision = get().loadRevision + 1;
    set({
      currentDocumentId: documentId,
      loadRevision,
      annotations: [],
      annotationsByPage: new Map(),
      selectedAnnotationId: null,
      editingAnnotationId: null,
    });
    try {
      const annotations = await ipcClient.listAnnotations(documentId);
      // 竞态检查：异步期间文档已切换则丢弃结果
      if (get().loadRevision !== loadRevision || get().currentDocumentId !== documentId) {
        return;
      }
      set({
        annotations,
        annotationsByPage: buildPageMap(annotations),
      });
    } catch (err) {
      console.error('加载标注失败:', err);
    }
  },

  createAnnotation: async (input) => {
    try {
      const dto = await ipcClient.saveAnnotation(input);
      set((state) => {
        const annotations = [...state.annotations, dto];
        return {
          annotations,
          annotationsByPage: buildPageMap(annotations),
        };
      });
      return dto;
    } catch (err) {
      console.error('创建标注失败:', err);
      return null;
    }
  },

  updateAnnotation: async (input) => {
    try {
      const dto = await ipcClient.updateAnnotation(input);
      set((state) => {
        const annotations = state.annotations.map((a) =>
          a.annotationId === dto.annotationId ? dto : a,
        );
        return {
          annotations,
          annotationsByPage: buildPageMap(annotations),
        };
      });
    } catch (err) {
      console.error('更新标注失败:', err);
    }
  },

  deleteAnnotation: async (annotationId) => {
    try {
      await ipcClient.deleteAnnotation(annotationId);
      set((state) => {
        const annotations = state.annotations.filter((a) => a.annotationId !== annotationId);
        return {
          annotations,
          annotationsByPage: buildPageMap(annotations),
          selectedAnnotationId:
            state.selectedAnnotationId === annotationId ? null : state.selectedAnnotationId,
          editingAnnotationId:
            state.editingAnnotationId === annotationId ? null : state.editingAnnotationId,
        };
      });
    } catch (err) {
      console.error('删除标注失败:', err);
    }
  },

  selectAnnotation: (id) => {
    set({ selectedAnnotationId: id });
  },

  startEditingNote: (id, anchor) => {
    set({
      editingAnnotationId: id,
      selectedAnnotationId: id,
      notePopupAnchor: anchor ?? null,
    });
  },

  stopEditingNote: () => {
    set({ editingAnnotationId: null, notePopupAnchor: null });
  },

  reset: () => {
    set({
      ...initialState,
      loadRevision: get().loadRevision + 1,
    });
  },
}));
