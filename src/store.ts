import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Message, SseStatus, StoreState } from './types'

const STORAGE_KEY = 'case-review-threads'

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      caseList: [],
      activeCase: null,
      threads: {},
      sseStatus: 'disconnected' as SseStatus,
      unread: new Set<string>(),

      setCaseList: (ids) => set({ caseList: ids }),

      setActiveCase: (id) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.delete(id)
          return { activeCase: id, unread }
        }),

      appendMessage: (caseId, msg: Message) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [caseId]: [...(state.threads[caseId] ?? []), msg],
          },
        })),

      rewindThread: (caseId, messageId) =>
        set((state) => {
          const thread = state.threads[caseId] ?? []
          const idx = thread.findIndex((m) => m.id === messageId)
          if (idx === -1) return {}
          return {
            threads: {
              ...state.threads,
              [caseId]: thread.slice(0, idx + 1),
            },
          }
        }),

      setSseStatus: (status) => set({ sseStatus: status }),

      markUnread: (caseId) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.add(caseId)
          return { unread }
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          const parsed = JSON.parse(str)
          parsed.state.unread = new Set(parsed.state.unread ?? [])
          return parsed
        },
        setItem: (name, value) => {
          const toStore = { ...value, state: { ...value.state, unread: [...value.state.unread] } }
          localStorage.setItem(name, JSON.stringify(toStore))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)
