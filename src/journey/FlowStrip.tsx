import { useMemo } from 'react'
import { useStore } from '../store'
import type { AgentRun, Turn } from '../types'
import s from './FlowStrip.module.css'

const EMPTY: Turn[] = []

/**
 * Live orchestration for the turn being viewed — who was dispatched, who has
 * finished, how long each took.
 *
 * Deliberately NOT the classic OrchestrationFlowPanel. That renders each
 * agent's sub-question in full, which is the single densest text in the app
 * and unreadable in a third of a column. This answers only "what is running
 * right now, and what came back" — the shape of the turn, not its content.
 * The sub-questions are still one click away in the trace above.
 */
export function FlowStrip({ caseId }: { caseId: string | null }) {
  const turns = useStore((st) => (caseId ? st.turns[caseId] : undefined)) ?? EMPTY
  const activeTurnId = useStore((st) => (caseId ? st.activeTurnId[caseId] : null))

  const turn = useMemo(
    () => turns.find((t) => t.turn_id === activeTurnId) ?? turns[turns.length - 1] ?? null,
    [turns, activeTurnId],
  )

  if (!turn) {
    return (
      <div className={s.strip}>
        <div className={s.head}><span className={s.title}>Orchestration</span></div>
        <p className={s.empty}>No turn selected.</p>
      </div>
    )
  }

  const runs: AgentRun[] = turn.agent_runs ?? []
  const done = runs.filter((r) => r.payload !== undefined).length
  const streaming = turn.status === 'streaming'

  return (
    <div className={s.strip}>
      <div className={s.head}>
        <span className={s.title}>Orchestration</span>
        <span className={`${s.badge} ${streaming ? s.badgeLive : ''}`}>
          {/* "in progress", not "running": the rows below say "running" about
              individual agents, and the same word describing both the turn
              and an agent inside it reads as though one were the other. */}
          {streaming ? 'in progress' : turn.status}
        </span>
        <span className={s.count}>
          {done}/{runs.length || '—'} agents
        </span>
      </div>

      <div className={s.list}>
        {runs.length === 0 && (
          <p className={s.empty}>
            {streaming ? 'Constructing the team…' : 'No agents ran on this turn.'}
          </p>
        )}
        {runs.map((r) => {
          const finished = r.payload !== undefined
          const err = turn.errorsBySpecialist?.[r.tool]
          return (
            <div key={r.call_id} className={s.row}>
              <span className={[
                s.dot,
                err ? s.dotError : finished ? s.dotDone : s.dotRunning,
              ].join(' ')} />
              <span className={s.tool} title={r.tool}>{r.tool}</span>
              <span className={s.timing}>
                {err
                  ? 'failed'
                  : finished
                    ? (r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : 'done')
                    : 'running'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
