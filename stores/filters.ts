import { create } from 'zustand'
import type { TaskStatus } from '@/types/tasks'

interface FiltersState {
  activeTab: TaskStatus
  selectedAssignee: string
  searchQuery: string
  setActiveTab: (t: TaskStatus) => void
  setSelectedAssignee: (id: string) => void
  setSearchQuery: (q: string) => void
}

export const useFiltersStore = create<FiltersState>()((set) => ({
  activeTab: 'IN_PROGRESS',
  selectedAssignee: 'all',
  searchQuery: '',
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedAssignee: (selectedAssignee) => set({ selectedAssignee }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}))
