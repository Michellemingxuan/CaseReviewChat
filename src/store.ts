import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentRun, CaseList, ChartInfo, Message, PendingChart, SseStatus, StoreState } from './types'

const STORAGE_KEY = 'case-review-threads-v6'

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
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
        // Also drops the corresponding reasoning-trace turns and resets the
        // active turn pointer so the right-side panels (audit trace and
        // orchestration flow) don't display traces for messages that no
        // longer exist in the chat.
        // Returns the reviewer's text so the caller can prefill the input
        // box for editing — empty string if nothing to rewind to.
        const state = get()
        const thread = state.threads[caseId] ?? []
        const clickedIdx = thread.findIndex((m) => m.id === messageId)
        if (clickedIdx === -1) return ''
        // Walk backward to find the owning reviewer message.
        let revIdx = -1
        for (let i = clickedIdx; i >= 0; i--) {
          if (thread[i].role === 'reviewer') { revIdx = i; break }
        }
        // Compute the new thread, then derive which trace turns survive.
        const newThread = revIdx === -1
          ? thread.slice(0, clickedIdx)
          : thread.slice(0, revIdx)
        const survivingTurnIds = new Set(
          newThread.map((m) => m.turn_id).filter((t): t is string => !!t)
        )
        const survivingTurns = (state.turns[caseId] ?? []).filter(
          (t) => survivingTurnIds.has(t.turn_id)
        )
        const prevActive = state.activeTurnId[caseId] ?? null
        const newActive = prevActive && survivingTurnIds.has(prevActive)
          ? prevActive
          : (survivingTurns.length > 0 ? survivingTurns[survivingTurns.length - 1].turn_id : null)
        set((s) => ({
          threads:      { ...s.threads,      [caseId]: newThread },
          turns:        { ...s.turns,        [caseId]: survivingTurns },
          activeTurnId: { ...s.activeTurnId, [caseId]: newActive },
        }))
        if (revIdx === -1) return ''
        return thread[revIdx].text
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
        set((state) => {
          // Auto-follow the latest turn by default, but preserve a user's
          // explicit selection when they've clicked back to an older turn.
          // Without this guard, a `turn_started` SSE event for a new
          // question clobbers the user's selection mid-streaming and the
          // right-side trace panels snap back to the new turn.
          const existing = state.turns[caseId] ?? []
          const prevActive = state.activeTurnId[caseId] ?? null
          const lastTurnId = existing.length > 0 ? existing[existing.length - 1].turn_id : null
          const userOnHistorical =
            prevActive != null && lastTurnId != null && prevActive !== lastTurnId
          const nextActive = userOnHistorical ? prevActive : turn.turn_id
          return {
            turns: { ...state.turns, [caseId]: [...existing, turn] },
            activeTurnId: { ...state.activeTurnId, [caseId]: nextActive },
          }
        }),

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

      upsertChart: (caseId, turnId, chart: ChartInfo) =>
        set((state) => {
          const list = state.turns[caseId] ?? []
          const next = list.map((t) => {
            if (t.turn_id !== turnId) return t
            const existing = t.charts ?? []
            // Dedup by (specialist, topic): later emission wins so a
            // distiller-revised chart can supersede an earlier explicit
            // make_chart call (matches server-side `_collect_turn_charts`).
            const idx = existing.findIndex(
              (c) => c.specialist === chart.specialist && c.topic === chart.topic
            )
            const merged: ChartInfo[] =
              idx === -1
                ? [...existing, chart]
                : existing.map((c, i) => (i === idx ? { ...c, ...chart } : c))
            // Clear any matching `pendingCharts` entry — the real chart
            // has arrived and superseded its placeholder.
            const pending = (t.pendingCharts ?? []).filter(
              (p) => !(p.specialist === chart.specialist && p.topic === chart.topic)
            )
            return { ...t, charts: merged, pendingCharts: pending }
          })
          return { turns: { ...state.turns, [caseId]: next } }
        }),

      upsertPendingChart: (caseId, turnId, pending: PendingChart) =>
        set((state) => {
          const list = state.turns[caseId] ?? []
          const next = list.map((t) => {
            if (t.turn_id !== turnId) return t
            // If the actual chart already arrived (rare ordering race),
            // ignore the pending event so we don't show a stale placeholder.
            const realAlreadyArrived = (t.charts ?? []).some(
              (c) => c.specialist === pending.specialist && c.topic === pending.topic
            )
            if (realAlreadyArrived) return t
            const existing = t.pendingCharts ?? []
            const idx = existing.findIndex(
              (p) => p.specialist === pending.specialist && p.topic === pending.topic
            )
            const merged: PendingChart[] =
              idx === -1
                ? [...existing, pending]
                : existing.map((p, i) => (i === idx ? { ...p, ...pending } : p))
            return { ...t, pendingCharts: merged }
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
