import { useEffect, useRef } from 'react'
import { openSSE } from '../api'
import { useStore } from '../store'
import type { Message, Turn } from '../types'

const RECONNECT_DELAY_MS = 2000

/**
 * Open one SSE connection per active case. Translates the typed event stream
 * from `AgenticSys_v2/server.py` into store mutations.
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

  const esRef = useRef<EventSource | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    if (!caseId) return
    activeRef.current = true

    function connect() {
      if (!activeRef.current || !caseId) return
      const es = openSSE(caseId)
      esRef.current = es
      es.onopen = () => setSseStatus('connected')
      es.onerror = () => {
        setSseStatus('disconnected')
        es.close()
        esRef.current = null
        if (activeRef.current) timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
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
        const p = parse<{ turn_id: string; message: string }>(ev.data || '')
        if (!p) return
        patchTurn(caseId, p.turn_id, { status: 'error', error: p.message })
      })
    }

    connect()

    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      esRef.current?.close()
      esRef.current = null
      setSseStatus('disconnected')
    }
  }, [caseId, appendMessage, setSseStatus, startTurn, patchTurn, upsertAgentRun])
}
