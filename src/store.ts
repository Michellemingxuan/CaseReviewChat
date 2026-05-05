import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentRun, CaseList, Message, SseStatus, StoreState } from './types'

const STORAGE_KEY = 'case-review-threads-v6'

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      caseList: { consumer: [], commercial: [] } as CaseList,
      activeCase: null,
      threads: {},
      turns: {},
      activeTurnId: {},
      sseStatus: 'disconnected' as SseStatus,
      unread: new Set<string>(),

      setCaseList: (list) => set({ caseList: list }),

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

      rewindThread: (caseId, messageId) => {
        // Rewind to BEFORE the turn that owns the clicked message:
        // walk back from `messageId` to the most recent reviewer message
        // (including itself if the click was on a reviewer bubble), then
        // drop that reviewer message and everything after it.
        // Returns the reviewer's text so the caller can prefill the input
        // box for editing — empty string if nothing to rewind to.
        const state = useStore.getState()
        const thread = state.threads[caseId] ?? []
        const clickedIdx = thread.findIndex((m) => m.id === messageId)
        if (clickedIdx === -1) return ''
        // Walk backward to find the owning reviewer message.
        let revIdx = -1
        for (let i = clickedIdx; i >= 0; i--) {
          if (thread[i].role === 'reviewer') { revIdx = i; break }
        }
        if (revIdx === -1) {
          // No reviewer ancestor (shouldn't normally happen) — fall back to
          // dropping just the clicked message + everything after.
          set((s) => ({
            threads: { ...s.threads, [caseId]: thread.slice(0, clickedIdx) },
          }))
          return ''
        }
        const reviewerText = thread[revIdx].text
        set((s) => ({
          threads: { ...s.threads, [caseId]: thread.slice(0, revIdx) },
        }))
        return reviewerText
      },

      setSseStatus: (status) => set({ sseStatus: status }),

      markUnread: (caseId) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.add(caseId)
          return { unread }
        }),

      clearHistory: () =>
        set({ threads: {}, turns: {}, activeTurnId: {}, unread: new Set() }),

      // ── Turn / trace actions ───────────────────────────────────────────

      startTurn: (caseId, turn) =>
        set((state) => ({
          turns: {
            ...state.turns,
            [caseId]: [...(state.turns[caseId] ?? []), turn],
          },
          activeTurnId: { ...state.activeTurnId, [caseId]: turn.turn_id },
        })),

      patchTurn: (caseId, turnId, patch) =>
        set((state) => {
          const list = state.turns[caseId] ?? []
          const next = list.map((t) => (t.turn_id === turnId ? { ...t, ...patch } : t))
          return { turns: { ...state.turns, [caseId]: next } }
        }),

      upsertAgentRun: (caseId, turnId, run: AgentRun) =>
        set((state) => {
          const list = state.turns[caseId] ?? []
          const next = list.map((t) => {
            if (t.turn_id !== turnId) return t
            const existingIdx = t.agent_runs.findIndex((r) => r.call_id === run.call_id)
            const merged: AgentRun[] =
              existingIdx === -1
                ? [...t.agent_runs, run]
                : t.agent_runs.map((r, i) => (i === existingIdx ? { ...r, ...run } : r))
            return { ...t, agent_runs: merged }
          })
          return { turns: { ...state.turns, [caseId]: next } }
        }),

      setActiveTurn: (caseId, turnId) =>
        set((state) => ({
          activeTurnId: { ...state.activeTurnId, [caseId]: turnId },
        })),
    }),
    {
      name: STORAGE_KEY,
      // Persist chat threads + completed traces so reopening the app restores
      // both the conversation and the reasoning history. Active turn pointer
      // also persists so the reasoning panel restores its last selection.
      partialize: (state) => ({
        caseList: state.caseList,
        activeCase: state.activeCase,
        threads: state.threads,
        turns: state.turns,
        activeTurnId: state.activeTurnId,
        unread: state.unread,
      }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          const parsed = JSON.parse(str)
          parsed.state.unread = new Set(parsed.state.unread ?? [])
          // Any turn that was mid-stream when the page closed is now orphaned;
          // mark it as error so the UI doesn't display "streaming…" forever.
          if (parsed.state.turns) {
            for (const caseId of Object.keys(parsed.state.turns)) {
              const list = parsed.state.turns[caseId]
              if (!Array.isArray(list)) continue
              parsed.state.turns[caseId] = list.map((t: { status?: string }) =>
                t.status === 'streaming'
                  ? { ...t, status: 'error', error: 'interrupted (session closed)' }
                  : t
              )
            }
          }
          return parsed
        },
        setItem: (name, value) => {
          const v = value as { state: { unread: Set<string> } }
          const toStore = {
            ...value,
            state: { ...v.state, unread: [...v.state.unread] },
          }
          localStorage.setItem(name, JSON.stringify(toStore))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)
