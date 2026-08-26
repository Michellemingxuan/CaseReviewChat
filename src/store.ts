import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentRun, CaseList, ChartInfo, Message, PendingChart, SseStatus, StoreState } from './types'

// Bumped v6 -> v7 when the journey shell shipped. The persisted SHAPE is
// unchanged, so this is not a migration — it is a deliberate one-time reset.
//
// Redeploying left browsers holding turns that were mid-flight against the
// OLD server process. That process is gone, so no answer can ever arrive, and
// the rehydrate path below intentionally does not cancel streaming turns (an
// accidental refresh must not kill live work). The result was questions stuck
// on "Working on it…" forever, visible only to whoever's browser held them.
//
// Bumping is close to lossless: `useCaseHistory` fetches `/history` on case
// open and `setCaseHistory` replaces the thread with the server's record, so
// completed turns come straight back. Only never-completed local state — the
// ghosts — is dropped. The stale-streaming check below stops NEW ones being
// created, but cannot reach state persisted before it existed.
const STORAGE_KEY = 'case-review-threads-v7'

/** A turn cannot legitimately still be running after this long: the server's
 *  own `TURN_WALL_CLOCK_S` budget is 360s, so anything older than that plus a
 *  margin belongs to a process that is no longer alive. */
const STALE_STREAMING_MS = 10 * 60 * 1000

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      caseList: { consumer: [], commercial: [] } as CaseList,
      activeCase: null,
      threads: {},
      turns: {},
      activeTurnId: {},
      sseStatus: 'disconnected' as SseStatus,
      // `useSSE`'s useEffect depends on this counter; bumping it tears
      // down the current EventSource and opens a fresh one. Exposed via
      // `forceReconnect()` below so the chat-header badge can offer a
      // one-click recovery instead of forcing a hard refresh.
      connectionEpoch: 0,
      unread: new Set<string>(),

      setCaseList: (list) => set({ caseList: list }),

      setActiveCase: (id) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.delete(id)
          return { activeCase: id, unread }
        }),

      appendMessage: (caseId, msg: Message) =>
        set((state) => {
          const thread = state.threads[caseId] ?? []
          // Idempotent by id: the SSE replay-on-reconnect buffer may re-send a
          // message this client already has (e.g. it dropped and reconnected
          // mid-turn). Skip the duplicate instead of showing two bubbles.
          if (msg.id && thread.some((m) => m.id === msg.id)) return {}
          // Idempotent by (turn_id, role): after history was loaded from the
          // server, the live SSE stream replays the same turn's message under a
          // DIFFERENT id. Applies to any role carrying a turn_id (agent always;
          // reviewer when the server tags it). Optimistic reviewer bubbles have
          // no turn_id and stay governed by the text+recency guard in useSSE.
          if (msg.turn_id &&
              thread.some((x) => x.turn_id === msg.turn_id && x.role === msg.role)) return {}
          return {
            threads: { ...state.threads, [caseId]: [...thread, msg] },
          }
        }),

      rewindThread: (caseId, messageId) => {
        // Rewind to BEFORE the turn that owns the clicked message:
        // walk back from `messageId` to the most recent reviewer message
        // (including itself if the click was on a reviewer bubble), then
        // drop that reviewer message and everything after it.
        // Also drops the corresponding reasoning-trace turns and resets the
        // active turn pointer so the right-side panels (audit trace and
        // orchestration flow) don't display traces for messages that no
        // longer exist in the chat.
        // Returns the reviewer's text + removed turn IDs so the caller
        // can prefill the input box and tell the server which turns to drop.
        const state = get()
        const thread = state.threads[caseId] ?? []
        const allTurns = state.turns[caseId] ?? []
        const clickedIdx = thread.findIndex((m) => m.id === messageId)
        if (clickedIdx === -1) return { text: '', removedTurnIds: [] }
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
        // Turn ids come from the messages being dropped, not from `allTurns`
        // alone: `state.turns` only holds turns that streamed live in THIS
        // browser session, and nothing repopulates it from /history. After a
        // server restart a restored message carries a valid turn_id in the
        // thread but has no entry here, so deriving ids from the trace array
        // alone sends the server ids that match no qa_cache entry — the
        // rewind clears the UI, clears nothing server-side, and the turns
        // come back on the next restart. The union keeps trace-row cleanup.
        const removedMessages = revIdx === -1
          ? thread.slice(clickedIdx)
          : thread.slice(revIdx)
        const removedTurnIds = Array.from(new Set([
          ...removedMessages.map((m) => m.turn_id).filter((t): t is string => !!t),
          ...allTurns
            .filter((t) => !survivingTurnIds.has(t.turn_id))
            .map((t) => t.turn_id),
        ]))
        const survivingTurns = allTurns.filter(
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
        const text = revIdx === -1 ? '' : thread[revIdx].text
        return { text, removedTurnIds }
      },

      setSseStatus: (status) => set({ sseStatus: status }),

      forceReconnect: () =>
        set((state) => ({ connectionEpoch: state.connectionEpoch + 1 })),

      markUnread: (caseId) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.add(caseId)
          return { unread }
        }),

      clearHistory: () =>
        set({ threads: {}, turns: {}, activeTurnId: {}, unread: new Set() }),

      clearCaseHistory: (caseId) =>
        set((state) => {
          const threads = { ...state.threads }; delete threads[caseId]
          const turns = { ...state.turns }; delete turns[caseId]
          const activeTurnId = { ...state.activeTurnId }; delete activeTurnId[caseId]
          const unread = new Set(state.unread); unread.delete(caseId)
          return { threads, turns, activeTurnId, unread }
        }),

      setCaseHistory: (caseId, messages) =>
        set((state) => {
          const existing = state.threads[caseId] ?? []
          // Server history is authoritative for completed turns — INCLUDING
          // when it is empty. A rewind or clear-history legitimately leaves
          // nothing, and treating [] as "no information" made those clears
          // impossible to stick: the thread came back on the next restart,
          // and a case cleared on one device never cleared on another.
          //
          // Only genuinely in-flight local messages survive a server list
          // that omits them: an optimistic bubble with no turn_id yet, or a
          // turn still streaming and so not yet in the server's qa_cache.
          // Anything else the server doesn't list is a completed turn it has
          // authoritatively dropped, so drop it here too.
          const streaming = new Set(
            (state.turns[caseId] ?? [])
              .filter((t) => t.status === 'streaming')
              .map((t) => t.turn_id))
          // Match by id, by (turn_id, role), or by (role, text) for
          // optimistic bubbles that carry no turn_id.
          const ids = new Set(messages.map((m) => m.id))
          const turnRoles = new Set(
            messages.filter((m) => m.turn_id).map((m) => `${m.turn_id} ${m.role}`))
          const roleTexts = new Set(messages.map((m) => `${m.role} ${m.text}`))
          const extras = existing.filter((m) =>
            !ids.has(m.id) &&
            !(m.turn_id && turnRoles.has(`${m.turn_id} ${m.role}`)) &&
            !roleTexts.has(`${m.role} ${m.text}`) &&
            (!m.turn_id || streaming.has(m.turn_id)))
          return { threads: { ...state.threads, [caseId]: [...messages, ...extras] } }
        }),

      // ── Turn / trace actions ───────────────────────────────────────────

      startTurn: (caseId, turn) =>
        set((state) => {
          // Auto-follow the latest turn by default, but preserve a user's
          // explicit selection when they've clicked back to an older turn.
          // Without this guard, a `turn_started` SSE event for a new
          // question clobbers the user's selection mid-streaming and the
          // right-side trace panels snap back to the new turn.
          const existing = state.turns[caseId] ?? []
          // Idempotent by turn_id: the backend replays buffered events
          // (including `turn_started`) on every SSE reconnect, and a
          // hard-refresh triggers a reconnect. Without this guard each replay
          // re-appended the same turn, inflating the "Turn X of N" navigator
          // (e.g. 2 real turns shown as 8). Skip the duplicate and leave the
          // existing turn + activeTurnId untouched. (Mirrors appendMessage.)
          if (existing.some((t) => t.turn_id === turn.turn_id)) return {}
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

      removePendingChart: (caseId, turnId, key) =>
        set((state) => {
          const list = state.turns[caseId] ?? []
          const next = list.map((t) => {
            if (t.turn_id !== turnId) return t
            const pending = (t.pendingCharts ?? []).filter(
              (p) => !(p.specialist === key.specialist && p.topic === key.topic)
            )
            if (pending.length === (t.pendingCharts ?? []).length) return t
            return { ...t, pendingCharts: pending }
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
          // Self-heal duplicate turns left behind by a prior build that
          // appended `turn_started` non-idempotently on replay/reload (which
          // inflated the "Turn X of N" navigator). Keep the first occurrence
          // of each turn_id per case. Replayed duplicates carried identical
          // content — every patchTurn/upsert maps ALL entries matching a
          // turn_id — so first-wins loses nothing. New writes are deduped at
          // the source in `startTurn`; this just cleans already-persisted state.
          const turns = parsed.state.turns
          if (turns && typeof turns === 'object') {
            for (const cid of Object.keys(turns)) {
              const list = turns[cid]
              if (!Array.isArray(list)) continue
              const seen = new Set<string>()
              turns[cid] = list.filter((t: { turn_id?: string }) => {
                if (!t || t.turn_id == null || seen.has(t.turn_id)) return false
                seen.add(t.turn_id)
                return true
              })
            }
          }
          // Do NOT mark a RECENT mid-stream turn as interrupted on reload. The
          // server turn keeps running across an SSE disconnect — ONLY
          // Stop/Rewind cancels it (server.py sets cancel_in_flight) — and SSE
          // replay-on-reconnect resumes it when the page reconnects. So an
          // accidental hard-refresh is a no-op: leave streaming turns as-is and
          // let the replayed + live events bring them to 'done' (or a real
          // server error). Falsely flipping them here would interrupt work the
          // user didn't mean to stop.
          //
          // But an OLD one is a different case, and this note used to call it
          // "acceptable and rare". A redeploy makes it neither: every turn in
          // flight when the process died is stranded, and because nothing ever
          // resolves it the question sits on "Working on it…" indefinitely —
          // in one person's browser and no one else's, which is a confusing
          // thing to debug. The server's own turn budget (`TURN_WALL_CLOCK_S`,
          // 360s) bounds how long a live turn can possibly last, so past that
          // plus a margin the owning process is provably gone. Say so instead
          // of pretending it is still working.
          for (const cid of Object.keys(turns ?? {})) {
            const list = turns[cid]
            if (!Array.isArray(list)) continue
            for (const t of list) {
              if (!t || t.status !== 'streaming') continue
              const age = Date.now() - (t.started_at ?? 0)
              // `started_at` is epoch ms from the server. A missing or absurd
              // value reads as very old; that is the safe direction, since the
              // alternative is a ghost that never clears.
              if (age < STALE_STREAMING_MS) continue
              t.status = 'error'
              t.errorKind = 'interrupted'
              t.error = 'Interrupted — the server restarted while this turn '
                + 'was running. Ask again to retry.'
              t.outcome = 'aborted'
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
