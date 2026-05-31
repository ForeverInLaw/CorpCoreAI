import { create } from 'zustand'
import type { UserPayload } from '@/types/tasks'

interface AuthState {
  isAuthorized: boolean
  currentUser: UserPayload | null
  accessDenied: boolean
  setAuthorized: (v: boolean) => void
  setCurrentUser: (u: UserPayload | null) => void
  setAccessDenied: (v: boolean) => void
  reset: () => void
}

const INITIAL: Pick<
  AuthState,
  'isAuthorized' | 'currentUser' | 'accessDenied'
> = {
  isAuthorized: false,
  currentUser: null,
  accessDenied: false,
}

export const useAuthStore = create<AuthState>()((set) => ({
  ...INITIAL,
  setAuthorized: (v) => set({ isAuthorized: v }),
  setCurrentUser: (u) => set({ currentUser: u }),
  setAccessDenied: (v) => set({ accessDenied: v }),
  reset: () => set(INITIAL),
}))
