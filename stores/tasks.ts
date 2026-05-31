import { create } from 'zustand'
import type { Task, EmployeeOption, Attachment } from '@/types/tasks'

interface TasksState {
  tasks: Task[]
  loading: boolean
  loadingMore: boolean
  nextCursor: string | null
  employees: EmployeeOption[]

  setTasks: (tasks: Task[]) => void
  appendTasks: (tasks: Task[]) => void
  addAttachment: (taskId: string, attachment: Attachment) => void
  setLoading: (v: boolean) => void
  setLoadingMore: (v: boolean) => void
  setNextCursor: (c: string | null) => void
  setEmployees: (e: EmployeeOption[]) => void
  reset: () => void
}

const INITIAL: Pick<
  TasksState,
  'tasks' | 'loading' | 'loadingMore' | 'nextCursor' | 'employees'
> = {
  tasks: [],
  loading: true,
  loadingMore: false,
  nextCursor: null,
  employees: [],
}

export const useTasksStore = create<TasksState>()((set) => ({
  ...INITIAL,
  setTasks: (tasks) => set({ tasks }),
  appendTasks: (more) => set((s) => ({ tasks: [...s.tasks, ...more] })),
  addAttachment: (taskId, attachment) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? { ...t, attachments: [...(t.attachments ?? []), attachment] }
          : t,
      ),
    })),
  setLoading: (loading) => set({ loading }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
  setNextCursor: (nextCursor) => set({ nextCursor }),
  setEmployees: (employees) => set({ employees }),
  reset: () => set(INITIAL),
}))
