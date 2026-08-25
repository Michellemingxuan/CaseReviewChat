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

// Heartbeat watchdog. The server emits a `ping` event every ~5s
// (AgenticSys_v2/server.py PING_INTERVAL_S). If we receive NOTHING — not a
// real event, not even a ping — for this long, the connection is silently
// half-open (readyState still OPEN, onerror never fired) and must be rebuilt.
// `onerror` / visibility / online don't catch this case, and `reconnectNow`
// deliberately bails when readyState===1, so without the watchdog a dead
// stream strands every later turn until a hard refresh (rewind can't fix it).
// 15s = 3 missed pings: long enough to never false-fire during a legitimately
// quiet specialist call (pings still flow every 5s), short enough to self-heal.
const HEARTBEAT_STALE_MS = 15_000
const WATCHDOG_CHECK_MS = 5_000

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
  const removePendingChart = useStore((s) => s.removePendingChart)
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
  // Timestamp (ms) of the last SSE activity — any event OR a server ping.
  // The watchdog compares against this to detect a silently-dead stream.
  const lastEventAtRef = useRef(0)
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

    function forceReconnect() {
      // Unconditional rebuild used by the staleness watchdog: unlike
      // `reconnectNow`, this does NOT bail on readyState===1 — the whole
      // point is that a half-open socket lies about being OPEN. Reset the
      // staleness clock so the freshly-built connection gets a full window.
      clearPendingTimer()
      esRef.current?.close()
      esRef.current = null
      attemptRef.current = 0
      lastEventAtRef.current = Date.now()
      connect()
    }

    function connect() {
      if (!activeRef.current || !caseId) return
      lastEventAtRef.current = Date.now()
      const es = openSSE(caseId)
      esRef.current = es
      es.onopen = () => {
        // Successful open — reset the backoff clock so the next blip
        // restarts from RECONNECT_BASE_MS, not from whatever-2^N-was.
        attemptRef.current = 0
        lastEventAtRef.current = Date.now()
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
        // Any inbound event counts as liveness for the staleness watchdog.
        lastEventAtRef.current = Date.now()
        try { return JSON.parse(raw) as T } catch { return null }
      }

      // Server keepalive. Carries no payload — its only job is to reset the
      // staleness clock so the watchdog doesn't reconnect during a quiet
      // (but healthy) stretch like a long-running specialist call.
      es.addEventListener('ping', () => {
        lastEventAtRef.current = Date.now()
      })

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
            // Only the optimistic bubble this echo is meant to replace.
            // Restored history now carries real timestamps too (the server
            // sends them so a reloaded thread isn't a list of undated rows),
            // and matching one of those would silently drop the echo for a
            // question legitimately re-asked within the window.
            !existing.id.startsWith('hist:') &&
            Math.abs((existing.timestamp ?? 0) - (m.timestamp ?? 0)) < 30_000
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

      // `chart_cancelled` retracts a placeholder that will NEVER be filled.
      // `chart_pending` fires per specialist DURING the turn, but the real
      // `chart` events land at END of turn, after the server dedups identical
      // figures across specialists. Anything dedup drops has already had its
      // placeholder announced and no `chart` event is coming — without this the
      // card spins forever next to the real one, which reads to the reviewer as
      // "two specialists drew the same plot". Only the server knows what it
      // chose not to emit, so it tells us.
      es.addEventListener('chart_cancelled', (e) => {
        const p = parse<{
          turn_id: string
          specialist: string
          topic: string
          reason?: string
        }>(e.data)
        if (!p) return
        removePendingChart(caseId, p.turn_id, {
          specialist: p.specialist,
          topic: p.topic,
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
        // Look up the prior turn state. If an `error` event already
        // arrived (typical for user-pressed-Stop, where the backend
        // emits error BEFORE turn_done) the turn is already in
        // `status: 'error'` — don't overwrite to 'done' or the
        // orchestration-flow panel loses its interruption indicator
        // the instant turn_done lands. The other fields (ended_at,
        // duration_ms, outcome) still update so the trace shows the
        // turn closed cleanly.
        const turns = useStore.getState().turns[caseId] ?? []
        const prior = turns.find((t) => t.turn_id === p.turn_id)
        const nextStatus: Turn['status'] =
          prior?.status === 'error' ? 'error' : 'done'
        patchTurn(caseId, p.turn_id, {
          ended_at: p.ended_at, duration_ms: p.duration_ms,
          outcome: p.outcome, status: nextStatus,
        })
      })

      // Application-level turn error. MUST NOT be named 'error': in
      // EventSource, 'error' is the RESERVED connection-error event, so a
      // server-sent `event: error` also fires `es.onerror` above → a spurious
      // reconnect. Combined with replay-on-reconnect that turns into a
      // self-sustaining reconnect storm (the buffered error replays on every
      // reconnect). The backend emits `turn_error`; keep these names in sync.
      es.addEventListener('turn_error', (e) => {
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
        // turn as failed — the turn can still produce a final answer. BUT
        // they must NOT be silently dropped either: the reasoning trace
        // needs to surface WHICH specialist failed and why, so the reviewer
        // can spot a partial answer instead of trusting it as complete.
        // We attach per-specialist recoverable errors to the turn under
        // `errorsBySpecialist` so the OrchestrationFlowPanel can render
        // them on the matching agent node.
        if (p.recoverable) {
          if (p.specialist) {
            const turns = useStore.getState().turns[caseId] ?? []
            const turn = turns.find((t) => t.turn_id === p.turn_id)
            const existing = (turn?.errorsBySpecialist ?? {}) as Record<string, string>
            // Preserve the first error per specialist (failures rarely
            // repeat for the same specialist within one turn; if they do,
            // the first is the load-bearing diagnosis).
            if (!existing[p.specialist]) {
              patchTurn(caseId, p.turn_id, {
                errorsBySpecialist: {
                  ...existing,
                  [p.specialist]: p.error_type
                    ? `${p.error_type}: ${p.message}`
                    : p.message,
                },
              })
            }
          }
          return
        }
        patchTurn(caseId, p.turn_id, {
          status: 'error',
          error: p.message,
          errorKind: p.kind,
        })
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

    // Staleness watchdog: a single interval for the effect's lifetime. It
    // checks the most recent connection (esRef) and rebuilds it if no event
    // or ping has arrived within HEARTBEAT_STALE_MS — catching silent
    // half-open deaths that onerror/visibility/online miss.
    lastEventAtRef.current = Date.now()
    watchdogRef.current = setInterval(() => {
      if (!activeRef.current) return
      // Only police a connection we believe is healthy and open: attemptRef
      // is 0 only after a successful onopen (it increments during onerror
      // backoff). While backoff is recovering, leave it alone — otherwise the
      // watchdog and the backoff loop fight and spawn duplicate connections.
      if (!esRef.current || attemptRef.current !== 0) return
      if (Date.now() - lastEventAtRef.current > HEARTBEAT_STALE_MS) {
        forceReconnect()
      }
    }, WATCHDOG_CHECK_MS)

    return () => {
      activeRef.current = false
      clearPendingTimer()
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current)
        watchdogRef.current = null
      }
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
  }, [caseId, appendMessage, setSseStatus, startTurn, patchTurn, upsertAgentRun, upsertChart, upsertPendingChart, removePendingChart, setActiveTurn, connectionEpoch])
}
