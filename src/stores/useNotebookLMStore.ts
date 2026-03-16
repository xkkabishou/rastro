import { create } from 'zustand';
import type {
  AppError,
  NotebookArtifactSummary,
  NotebookLMStatus,
  NotebookLMTask,
  NotebookSummary,
} from '../shared/types';
import { notebooklmClient } from '../lib/notebooklm-client';

const MAX_TASKS = 8;

interface NotebookLMState {
  status: NotebookLMStatus | null;
  notebooks: NotebookSummary[];
  selectedNotebookId: string | null;
  artifacts: NotebookArtifactSummary[];
  activeTask: NotebookLMTask | null;
  recentTasks: NotebookLMTask[];
  loading: boolean;
  busy: boolean;
  error: AppError | null;
  refreshStatus: () => Promise<void>;
  selectNotebook: (notebookId: string | null) => Promise<void>;
  beginLogin: () => Promise<void>;
  openExternal: () => Promise<void>;
  logout: () => Promise<void>;
  createNotebook: (title: string, description?: string) => Promise<void>;
  attachCurrentPdf: (pdfPath: string) => Promise<void>;
  generateMindMap: () => Promise<void>;
  refreshTask: () => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  downloadArtifact: (artifact: NotebookArtifactSummary) => Promise<void>;
  clearError: () => void;
}

function asAppError(error: unknown): AppError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'retryable' in error
  ) {
    return error as AppError;
  }

  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : '发生未知错误',
    retryable: false,
  };
}

function upsertTask(tasks: NotebookLMTask[], task: NotebookLMTask): NotebookLMTask[] {
  const next = [task, ...tasks.filter((item) => item.id !== task.id)];
  return next.slice(0, MAX_TASKS);
}

export const useNotebookLMStore = create<NotebookLMState>((set, get) => ({
  status: null,
  notebooks: [],
  selectedNotebookId: null,
  artifacts: [],
  activeTask: null,
  recentTasks: [],
  loading: false,
  busy: false,
  error: null,

  refreshStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await notebooklmClient.getStatus();
      const selectedNotebookId =
        get().selectedNotebookId && status.notebooks.some((item) => item.id === get().selectedNotebookId)
          ? get().selectedNotebookId
          : status.notebooks[0]?.id ?? null;
      set({
        status,
        notebooks: status.notebooks,
        selectedNotebookId,
        loading: false,
      });
      if (selectedNotebookId) {
        await get().refreshArtifacts();
      } else {
        set({ artifacts: [] });
      }
    } catch (error) {
      set({
        loading: false,
        error: asAppError(error),
      });
    }
  },

  selectNotebook: async (notebookId) => {
    set({ selectedNotebookId: notebookId });
    if (notebookId) {
      await get().refreshArtifacts();
    } else {
      set({ artifacts: [] });
    }
  },

  beginLogin: async () => {
    set({ busy: true, error: null });
    try {
      await notebooklmClient.beginLogin();
      set({ busy: false });
      await get().refreshStatus();
    } catch (error) {
      set({ busy: false, error: asAppError(error) });
    }
  },

  openExternal: async () => {
    try {
      await notebooklmClient.openExternal();
    } catch (error) {
      set({ error: asAppError(error) });
    }
  },

  logout: async () => {
    set({ busy: true, error: null });
    try {
      await notebooklmClient.logout();
      set({
        busy: false,
        status: null,
        notebooks: [],
        selectedNotebookId: null,
        artifacts: [],
        activeTask: null,
        recentTasks: [],
      });
    } catch (error) {
      set({ busy: false, error: asAppError(error) });
    }
  },

  createNotebook: async (title, description) => {
    set({ busy: true, error: null });
    try {
      const notebook = await notebooklmClient.createNotebook({ title, description });
      const notebooks = [notebook, ...get().notebooks.filter((item) => item.id !== notebook.id)];
      const currentStatus = get().status;
      const status: NotebookLMStatus | null = currentStatus
        ? { ...currentStatus, notebooks }
        : null;
      set({
        busy: false,
        notebooks,
        selectedNotebookId: notebook.id,
        status,
      });
      await get().refreshArtifacts();
    } catch (error) {
      set({ busy: false, error: asAppError(error) });
    }
  },

  attachCurrentPdf: async (pdfPath) => {
    const notebookId = get().selectedNotebookId;
    if (!notebookId) {
      set({
        error: {
          code: 'NOTEBOOKLM_UNKNOWN',
          message: '请先选择或创建一个 Notebook。',
          retryable: false,
        },
      });
      return;
    }

    set({ busy: true, error: null });
    try {
      const task = await notebooklmClient.attachCurrentPdf({ notebookId, pdfPath });
      set({
        busy: false,
        activeTask: task,
        recentTasks: upsertTask(get().recentTasks, task),
      });
    } catch (error) {
      set({ busy: false, error: asAppError(error) });
    }
  },

  generateMindMap: async () => {
    const notebookId = get().selectedNotebookId;
    if (!notebookId) {
      set({
        error: {
          code: 'NOTEBOOKLM_UNKNOWN',
          message: '请先选择或创建一个 Notebook。',
          retryable: false,
        },
      });
      return;
    }

    set({ busy: true, error: null });
    try {
      const task = await notebooklmClient.generateArtifact({
        notebookId,
        artifactType: 'mind-map',
      });
      set({
        busy: false,
        activeTask: task,
        recentTasks: upsertTask(get().recentTasks, task),
      });
    } catch (error) {
      set({ busy: false, error: asAppError(error) });
    }
  },

  refreshTask: async () => {
    const currentTask = get().activeTask;
    if (!currentTask) {
      return;
    }

    try {
      const task = await notebooklmClient.getTask(currentTask.id);
      set({
        activeTask: task,
        recentTasks: upsertTask(get().recentTasks, task),
      });
      if (task.status === 'completed') {
        if (task.notebookId) {
          await get().refreshArtifacts();
        }
        await get().refreshStatus();
      }
      if (task.status === 'failed' && task.errorCode && task.errorMessage) {
        set({
          error: {
            code: task.errorCode,
            message: task.errorMessage,
            retryable: true,
          },
        });
      }
    } catch (error) {
      set({ error: asAppError(error) });
    }
  },

  refreshArtifacts: async () => {
    const notebookId = get().selectedNotebookId;
    if (!notebookId) {
      set({ artifacts: [] });
      return;
    }

    try {
      const artifacts = await notebooklmClient.listArtifacts(notebookId);
      set({ artifacts });
    } catch (error) {
      set({ error: asAppError(error) });
    }
  },

  downloadArtifact: async (artifact) => {
    set({ busy: true, error: null });
    try {
      const downloaded = await notebooklmClient.downloadArtifact({
        artifactId: artifact.id,
        artifactType: artifact.type,
        title: artifact.title,
      });
      set({
        busy: false,
        artifacts: get().artifacts.map((item) =>
          item.id === downloaded.id ? downloaded : item
        ),
      });
    } catch (error) {
      set({ busy: false, error: asAppError(error) });
    }
  },

  clearError: () => set({ error: null }),
}));
