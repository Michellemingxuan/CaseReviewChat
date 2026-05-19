import { useEffect, useRef } from 'react'
import { openSSE } from '../api'
import { useStore } from '../store'
import type { ChartInfo, Message, Turn } from '../types'

// Reconnect strategy: exponential backoff with a 30s cap. First failure
// waits 1s, then doubles (2 / 4 / 8 / 16 / 30 / 30 / ...). The backoff
// counter resets the moment a connection successfully opens — so a
// recovering network sees the NEXT blip start from 1s again, not
// whatever-the-backoff-grew-to during the prior outage.
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

/**
 * Open one SSE connection per active case. Translates the typed event stream
 * from `AgenticSys_v2/server.py` into store mutations.
 *
 * Reconnect behavior:
 * - On `onerror`, the EventSource is closed and a reconnect is scheduled
 *   with exponential backoff (base 1s, cap 30s). Backoff resets on
 *   successful `onopen` so a recovering connection doesn't carry stale
 *   delay from an earlier outage.
 * - `visibilitychange` (tab returning to foreground) and `online`
 *   (network coming back) BOTH force an immediate reconnect — this is the
 *   load-bearing fix for the "asked a question after 1h idle and got no
 *   reasoning trace" symptom. Without these, a silently-dead EventSource
 *   stays dead and the next POST /turn lands in a dead subscriber queue
 *   on the server (see AgenticSys_v2/server.py `turn_no_subscribers`).
 *
 * Backwards compatible with the legacy `event: message` from the JS mock —
 * messages still flow through `appendMessage`. The trace events (turn_started,
 * question_check, team_plan, agent_started, agent_completed, final, turn_done)
 * populate `turns` for the AuditTracePanel.
 */
export function useSSE(caseId: string | null) {
  const appendMessage = useStore((s) => s.appendMessage)
  const setSseStatus = useStore((s) => s.setSseStatus)
  const startTurn = useStore((s) => s.startTurn)
  const patchTurn = useStore((s) => s.patchTurn)
  const upsertAgentRun = useStore((s) => s.upsertAgentRun)
  const upsertChart = useStore((s) => s.upsertChart)
  const upsertPendingChart = useStore((s) => s.upsertPendingChart)
  const setActiveTurn = useStore((s) => s.setActiveTurn)
  // Subscribing to `connectionEpoch` lets a manual "Reconnect" button
  // (chat header) force the EventSource to tear down and rebuild —
  // the useEffect below re-runs whenever this number changes. Users
  // had to hard-refresh otherwise; with this they get one-click
  // recovery without losing the active case / thread / trace state.
  const connectionEpoch = useStore((s) => s.connectionEpoch)

  const esRef = useRef<EventSource | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)
  const attemptRef = useRef(0)

  useEffect(() => {
    if (!caseId) return
    activeRef.current = true
    attemptRef.current = 0

    function clearPendingTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    function reconnectNow() {
      // Tab returned to foreground or network restored: drop any pending
      // backoff timer and try immediately. If the existing EventSource is
      // genuinely still healthy (proxy didn't silently drop us), the
      // browser's CONNECTING/OPEN check below short-circuits the rebuild.
      clearPendingTimer()
      const es = esRef.current
      // readyState 1 = OPEN. Don't churn if we're already connected.
      if (es && es.readyState === 1) return
      es?.close()
      esRef.current = null
      attemptRef.current = 0  // visibility/online resets the backoff clock
      connect()
    }

    function connect() {
      if (!activeRef.current || !caseId) return
      const es = openSSE(caseId)
      esRef.current = es
      es.onopen = () => {
        // Successful open — reset the backoff clock so the next blip
        // restarts from RECONNECT_BASE_MS, not from whatever-2^N-was.
        attemptRef.current = 0
        setSseStatus('connected')
      }
      es.onerror = () => {
        setSseStatus('disconnected')
        es.close()
        esRef.current = null
        if (!activeRef.current) return
        const delay = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * Math.pow(2, attemptRef.current),
        )
        attemptRef.current += 1
        clearPendingTimer()
        timerRef.current = setTimeout(connect, delay)
      }

      const parse = <T,>(raw: string): T | null => {
        try { return JSON.parse(raw) as T } catch { return null }
      }

      // Legacy: { id, role, text, timestamp }
      es.addEventListener('message', (e) => {
        const m = parse<Message>(e.data)
        if (m) appendMessage(caseId, m)
      })

      // Reviewer message echo (with turn_id). The chat panel optimistically
      // appends the question on Send (see ChatPanel.handleSend), so this
      // server echo is normally a duplicate. Dedupe by matching against the
      // most recent reviewer message in the thread on text + a 30s recency
      // window — if it's a duplicate, skip; otherwise (e.g. page reloaded
      // mid-turn so optimistic add never happened) append as the fallback.
      es.addEventListener('reviewer_message', (e) => {
        const m = parse<Message>(e.data)
        if (!m) return
        const thread = useStore.getState().threads[caseId] ?? []
        const recentDup = thread.some(
          (existing) =>
            existing.role === 'reviewer' &&
            existing.text === m.text &&
            Math.abs((existing.timestamp ?? 0) - m.timestamp) < 30_000
        )
        if (recentDup) return
        appendMessage(caseId, m)
      })

      es.addEventListener('agent_message', (e) => {
        const m = parse<Message>(e.data)
        if (m) appendMessage(caseId, m)
      })

      es.addEventListener('turn_started', (e) => {
        const p = parse<{ turn_id: string; question: string; started_at: number }>(e.data)
        if (!p) return
        const turn: Turn = {
          turn_id: p.turn_id,
          question: p.question,
          started_at: p.started_at,
          agent_runs: [],
          status: 'streaming',
        }
        startTurn(caseId, turn)
      })

      es.addEventListener('question_check', (e) => {
        const p = parse<{ turn_id: string; passed: boolean; reason: string;
                          redacted_question: string; in_scope: boolean;
                          outcome: Turn['outcome'] }>(e.data)
        if (!p) return
        patchTurn(caseId, p.turn_id, {
          question_check: {
            passed: p.passed,
            reason: p.reason,
            redacted_question: p.redacted_question,
            in_scope: p.in_scope,
            outcome: p.outcome ?? 'ok',
          },
        })
        // When the chat agent REJECTS a question (out-of-scope, trivial,
        // etc.) snap the user to the rejecting turn so they see the
        // answer. The selection-priority rule
        // (.claude/memory/feedback_orchestration_flow_ux.md preference #1)
        // generally keeps users on the turn they were reviewing during
        // streaming — but rejections are sub-5s round-trips where the
        // user's mental model is "I asked a quick question, where's the
        // reply?". Staying on a prior long-running turn here reads as
        // "no response" because the new turn's question_check + final
        // never appear on screen.
        if (!p.passed) {
          setActiveTurn(caseId, p.turn_id)
        }
      })

      es.addEventListener('team_plan', (e) => {
        const p = parse<{ turn_id: string; tool_calls: Turn['team_plan'] }>(e.data)
        if (!p) return
        patchTurn(caseId, p.turn_id, { team_plan: p.tool_calls })
      })

      es.addEventListener('agent_started', (e) => {
        const p = parse<{ turn_id: string; call_id: string; tool: string; started_at: number }>(e.data)
        if (!p) return
        upsertAgentRun(caseId, p.turn_id, {
          call_id: p.call_id, tool: p.tool, started_at: p.started_at,
        })
      })

      es.addEventListener('agent_completed', (e) => {
        const p = parse<{ turn_id: string; call_id: string; tool: string;
                          payload: Record<string, unknown>; duration_ms: number }>(e.data)
        if (!p) return
        upsertAgentRun(caseId, p.turn_id, {
          call_id: p.call_id, tool: p.tool, payload: p.payload, duration_ms: p.duration_ms,
        })
      })

      es.addEventListener('final', (e) => {
        const p = parse<{ turn_id: string; answer: string; flags: string[];
                          timeline: unknown[]; data_pull_request: unknown }>(e.data)
        if (!p) return
        patchTurn(caseId, p.turn_id, {
          final: {
            answer: p.answer, flags: p.flags ?? [],
            timeline: p.timeline ?? [], data_pull_request: p.data_pull_request,
          },
        })
      })

      // `chart_pending` fires the moment a specialist calls `make_chart`
      // (after validation, before the matplotlib render). The PlotPanel
      // renders a "Working on the plot…" placeholder keyed by (specialist,
      // topic); the placeholder is replaced when the matching `chart`
      // event arrives at end-of-turn.
      es.addEventListener('chart_pending', (e) => {
        const p = parse<{
          turn_id: string
          specialist: string
          topic: string
          kind?: string
        }>(e.data)
        if (!p) return
        upsertPendingChart(caseId, p.turn_id, {
          specialist: p.specialist,
          topic: p.topic,
          kind: p.kind ?? '',
        })
      })

      // Chart events fire from the server's distiller-output pipeline (and
      // from the explicit `make_chart` tool). Each event carries one
      // chart's URL + the underlying claim/source so the reasoning-trace
      // panel can show a click-to-open button next to the relevant
      // finding. Charts NEVER appear inline in the chat answer.
      es.addEventListener('chart', (e) => {
        const p = parse<{
          turn_id: string
          specialist: string
          topic: string
          url: string
          claim?: string
          source_call?: string
          kind?: string
          vega_spec?: Record<string, unknown> | null
          // table-kind extras (absent on plot kinds)
          numbers?: Array<Record<string, unknown>>
          x_field?: string
          y_fields?: string[]
        }>(e.data)
        if (!p) return
        const chart: ChartInfo = {
          specialist: p.specialist,
          topic: p.topic,
          url: p.url,
          claim: p.claim ?? '',
          source_call: p.source_call ?? '',
          kind: p.kind ?? '',
          vega_spec: p.vega_spec ?? null,
          numbers: p.numbers,
          x_field: p.x_field,
          y_fields: p.y_fields,
        }
        upsertChart(caseId, p.turn_id, chart)
      })

      // Orchestrator retry: the backend retries once on a malformed
      // FinalAnswer. The frontend resets the prior attempt's mid-stream
      // state — the new attempt re-emits team_plan + agent_started events
      // under the same turn_id and the UI should display them as the
      // authoritative state. Charts already received from the first
      // attempt are preserved (specialists' KPs aren't re-rendered).
      es.addEventListener('orchestrator_retry', (e) => {
        const p = parse<{ turn_id: string; attempt: number; reason: string }>(e.data)
        if (!p) return
        patchTurn(caseId, p.turn_id, {
          team_plan: undefined,
          agent_runs: [],
          final: undefined,
        })
      })

      es.addEventListener('turn_done', (e) => {
        const p = parse<{ turn_id: string; ended_at: number; duration_ms: number;
                          outcome: Turn['outcome'] }>(e.data)
        if (!p) return
        patchTurn(caseId, p.turn_id, {
          ended_at: p.ended_at, duration_ms: p.duration_ms,
          outcome: p.outcome, status: 'done',
        })
      })

      es.addEventListener('error', (e) => {
        const ev = e as MessageEvent
        const p = parse<{
          turn_id: string
          message: string
          recoverable?: boolean
          specialist?: string
          error_type?: string
          kind?: string
        }>(ev.data || '')
        if (!p) return
        // Recoverable errors (e.g. one specialist failed but the orchestrator
        // is still synthesizing from the others) must NOT mark the entire
        // turn as failed — the turn can still produce a final answer. Only
        // hard failures (unrecoverable orchestrator/screen errors) terminate.
        if (p.recoverable) return
        patchTurn(caseId, p.turn_id, { status: 'error', error: p.message })
      })
    }

    // Visibility / network listeners: force a reconnect when the tab
    // returns to foreground or the network comes back. These are the
    // load-bearing fix for the "silent EventSource death during long
    // idle" symptom — without them, a tab backgrounded for an hour can
    // sit on a dead connection forever (its onerror may have fired into
    // a throttled timer that takes forever to retry, or never fired at
    // all if the underlying socket is in a half-open state). With them,
    // the moment the user comes back the connection is rebuilt before
    // they get a chance to ask a new question.
    function onVisibilityChange() {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        reconnectNow()
      }
    }
    function onOnline() {
      reconnectNow()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
    }

    connect()

    return () => {
      activeRef.current = false
      clearPendingTimer()
      esRef.current?.close()
      esRef.current = null
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
      }
      setSseStatus('disconnected')
    }
    // Note: upsertChart is bound when the chart SSE event arrives. It must
    // be in the deps so React re-runs the effect if Zustand's reference
    // ever changes (currently stable, but explicit deps protect against
    // future refactors).
  }, [caseId, appendMessage, setSseStatus, startTurn, patchTurn, upsertAgentRun, upsertChart, upsertPendingChart, setActiveTurn, connectionEpoch])
}
