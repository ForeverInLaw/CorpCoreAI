import { create } from 'zustand'
import type { TaskAssignmentMember } from '@/types/tasks'

interface UiState {
  uploadingTaskId: string | null
  uploadErrors: Record<string, string>
  downloadingAttachmentId: string | null
  updatingTasks: Record<string, boolean>
  updateErrors: Record<string, string>
  deadlineDrafts: Record<string, string>
  teamDrafts: Record<string, TaskAssignmentMember[]>
  teamErrors: Record<string, string>

  setUploadingTaskId: (id: string | null) => void
  setUploadError: (taskId: string, msg: string) => void
  setDownloadingAttachmentId: (id: string | null) => void
  setUpdating: (taskId: string, v: boolean) => void
  setUpdateError: (taskId: string, msg: string) => void
  setDeadlineDraft: (taskId: string, draft: string) => void
  setTeamDraft: (taskId: string, draft: TaskAssignmentMember[]) => void
  updateTeamDraft: (taskId: string, updater: (current: TaskAssignmentMember[]) => TaskAssignmentMember[]) => void
  setTeamError: (taskId: string, msg: string) => void
  initDrafts: (tasks: { id: string; deadline: string | null; assignments?: TaskAssignmentMember[] }[]) => void
  reset: () => void
}

const INITIAL: Omit<UiState, 'setUploadingTaskId' | 'setUploadError' | 'setDownloadingAttachmentId' | 'setUpdating' | 'setUpdateError' | 'setDeadlineDraft' | 'setTeamDraft' | 'updateTeamDraft' | 'setTeamError' | 'initDrafts' | 'reset'> = {
  uploadingTaskId: null,
  uploadErrors: {},
  downloadingAttachmentId: null,
  updatingTasks: {},
  updateErrors: {},
  deadlineDrafts: {},
  teamDrafts: {},
  teamErrors: {},
}

export const useUiStore = create<UiState>()((set) => ({
  ...INITIAL,
  setUploadingTaskId: (uploadingTaskId) => set({ uploadingTaskId }),
  setUploadError: (taskId, msg) =>
    set((s) => ({ uploadErrors: { ...s.uploadErrors, [taskId]: msg } })),
  setDownloadingAttachmentId: (downloadingAttachmentId) => set({ downloadingAttachmentId }),
  setUpdating: (taskId, v) =>
    set((s) => ({ updatingTasks: { ...s.updatingTasks, [taskId]: v } })),
  setUpdateError: (taskId, msg) =>
    set((s) => ({ updateErrors: { ...s.updateErrors, [taskId]: msg } })),
  setDeadlineDraft: (taskId, draft) =>
    set((s) => ({ deadlineDrafts: { ...s.deadlineDrafts, [taskId]: draft } })),
  setTeamDraft: (taskId, draft) =>
    set((s) => ({ teamDrafts: { ...s.teamDrafts, [taskId]: draft } })),
  updateTeamDraft: (taskId, updater) =>
    set((s) => ({
      teamDrafts: { ...s.teamDrafts, [taskId]: updater(s.teamDrafts[taskId] ?? []) },
    })),
  setTeamError: (taskId, msg) =>
    set((s) => ({ teamErrors: { ...s.teamErrors, [taskId]: msg } })),
  initDrafts: (tasks) =>
    set((s) => {
      const d: Record<string, string> = { ...s.deadlineDrafts }
      const t: Record<string, TaskAssignmentMember[]> = { ...s.teamDrafts }
      for (const task of tasks) {
        d[task.id] = task.deadline ? task.deadline.slice(0, 10) : ''
        t[task.id] = (task.assignments ?? []).map((m) => ({ ...m }))
      }
      return { deadlineDrafts: d, teamDrafts: t }
    }),
  reset: () => set(INITIAL),
}))
