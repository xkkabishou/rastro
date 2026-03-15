import type {
  AttachCurrentPdfInput,
  CreateNotebookInput,
  DownloadArtifactInput,
  GenerateArtifactInput,
  NotebookArtifactSummary,
  NotebookLMAuthStatus,
  NotebookLMStatus,
  NotebookLMTask,
  NotebookSummary,
} from '../shared/types';
import { ipcClient } from './ipc-client';

export const notebooklmClient = {
  getStatus: (): Promise<NotebookLMStatus> => ipcClient.getNotebookLMStatus(),
  beginLogin: (): Promise<NotebookLMAuthStatus> => ipcClient.beginNotebookLMLogin(),
  openExternal: (): Promise<void> => ipcClient.openNotebookLMExternal(),
  logout: (): Promise<NotebookLMAuthStatus> => ipcClient.logoutNotebookLM(),
  listNotebooks: (): Promise<NotebookSummary[]> => ipcClient.listNotebookLMNotebooks(),
  createNotebook: (input: CreateNotebookInput): Promise<NotebookSummary> =>
    ipcClient.createNotebookLMNotebook(input),
  attachCurrentPdf: (input: AttachCurrentPdfInput): Promise<NotebookLMTask> =>
    ipcClient.attachCurrentPdfToNotebookLM(input),
  generateArtifact: (input: GenerateArtifactInput): Promise<NotebookLMTask> =>
    ipcClient.generateNotebookLMArtifact(input),
  getTask: (taskId: string): Promise<NotebookLMTask> => ipcClient.getNotebookLMTask(taskId),
  listArtifacts: (notebookId: string): Promise<NotebookArtifactSummary[]> =>
    ipcClient.listNotebookLMArtifacts(notebookId),
  downloadArtifact: (input: DownloadArtifactInput): Promise<NotebookArtifactSummary> =>
    ipcClient.downloadNotebookLMArtifact(input),
};
