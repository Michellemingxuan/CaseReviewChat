import { useMemo } from 'react'
import { useStore } from '../store'
import { runStatus } from '../components/OrchestrationFlowPanel/OrchestrationFlowPanel'
import type { AgentRun, ToolCall, Turn } from '../types'
import s from './FlowStrip.module.css'

const EMPTY: Turn[] = []

/**
 * The orchestration flow, in the dark strip under the reasoning trace.
 *
 * Same grammar as the classic OrchestrationFlowPanel — screen → orchestrator →
 * fork → {report branch, team branch} → join → synthesis — because that shape
 * is what makes a turn legible: you can see at a glance that two things ran in
 * parallel and rejoined. A flat list loses exactly that.
 *
 * What it drops is the per-node sub-question. Those are the densest text in
 * the app and cannot be read in a third of a column; the trace directly above
 * carries them in full. This strip answers "what is the shape of this turn and
 * where is it now", not "what was each agent asked".
 *
 * `runStatus` is imported from the classic panel rather than reimplemented:
 * it encodes which recoverable errors count as failure, and two copies would
 * drift.
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

  const calls: ToolCall[] = turn.team_plan ?? []
  const runs: AgentRun[] = turn.agent_runs ?? []
  const runFor = (c: ToolCall) => runs.find((r) => r.call_id === c.call_id)

  const reportCalls = calls.filter((c) => c.tool === 'report_agent')
  const teamCalls = calls.filter((c) => c.tool !== 'report_agent')

  const streaming = turn.status === 'streaming'

  // The flow GROWS with the turn. A stage appears when the turn actually
  // reaches it, so a question that never gets past the screen — "what to
  // eat" — shows one node and stops, rather than a full pipeline of stages
  // that were never going to run. Same rule the classic panel uses.
  const rejected = turn.question_check?.passed === false
  const passed = turn.question_check?.passed === true
  // The `|| activity` half is a guard against event-ordering anomalies: if
  // downstream work somehow shows up before the check does, draw it rather
  // than hide real activity behind a flag that has not arrived yet.
  const activity = calls.length > 0 || runs.length > 0
  const showTeam = !rejected && (passed || activity)
  const showBranches = showTeam && activity
  const showSynth = !rejected && (turn.final != null || showBranches)

  const screened = rejected ? 'error'
    : turn.question_check ? 'done'
    : streaming ? 'running' : 'idle'
  const planned = calls.length > 0 ? 'done' : streaming ? 'running' : 'idle'
  const synth = turn.final ? 'done'
    : turn.status === 'error' ? 'error'
    : streaming ? 'running' : 'idle'

  const node = (c: ToolCall) => {
    const run = runFor(c)
    const st = runStatus(run, turn.status, turn.errorsBySpecialist?.[c.tool])
    return (
      <div key={c.call_id} className={`${s.node} ${s[st] ?? ''}`}
           title={turn.errorsBySpecialist?.[c.tool] || c.tool}>
        <span className={`${s.dot} ${s[st] ?? ''}`} />
        <span className={s.nodeName}>{c.tool}</span>
        <span className={s.nodeTime}>
          {st === 'error' ? 'failed'
            : run?.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s`
            : st === 'running' ? '…' : ''}
        </span>
      </div>
    )
  }

  return (
    <div className={s.strip}>
      <div className={s.head}>
        <span className={s.title}>Orchestration</span>
        <span className={`${s.badge} ${streaming ? s.badgeLive : ''}`}>
          {/* "in progress", not "running": the nodes below say "running" about
              individual agents, and one word for both reads as though the
              turn were an agent. */}
          {streaming ? 'in progress' : turn.status}
        </span>
      </div>

      <div className={s.flow}>
        {/* Screen sits ABOVE team rather than beside it: they are the two
            single-agent stages before the fork, and stacking them buys back
            the width the branches need. */}
        <div className={s.entry}>
          <div className={`${s.stage} ${s.screen} ${s[screened] ?? ''}`}>
            <span className={`${s.dot} ${s[screened] ?? ''}`} />screen
          </div>
          {showTeam && (
            <>
              <span className={s.arrowDown}>↓</span>
              <div className={`${s.stage} ${s.teamStage} ${s[planned] ?? ''}`}>
                <span className={`${s.dot} ${s[planned] ?? ''}`} />team
              </div>
            </>
          )}
        </div>

        {/* The reason the turn stopped, stated where it stopped. Without it a
            rejected turn is just a lone node with no explanation. */}
        {rejected && (
          <span className={s.stopped}>
            {turn.question_check?.in_scope === false ? 'out of scope' : 'not accepted'}
          </span>
        )}

        {showBranches && <span className={s.arrow}>→</span>}

        {/* The fork. Two branches side by side, which is what shows that they
            ran in parallel rather than in sequence. */}
        {showBranches && <div className={s.branches}>
          <div className={`${s.branch} ${s.report}`}>
            <div className={s.branchLabel}>
              Report <span className={s.branchCount}>{reportCalls.length || 'idle'}</span>
            </div>
            {reportCalls.length === 0
              ? <div className={s.placeholder}>not dispatched</div>
              : reportCalls.map(node)}
          </div>
          <div className={`${s.branch} ${s.specialists}`}>
            <div className={s.branchLabel}>
              Specialists <span className={s.branchCount}>{teamCalls.length || 'idle'}</span>
            </div>
            {teamCalls.length === 0
              ? <div className={s.placeholder}>not dispatched</div>
              : teamCalls.map(node)}
          </div>
        </div>}

        {showSynth && <span className={s.arrow}>→</span>}
        {showSynth && (
          <div className={`${s.stage} ${s[synth] ?? ''}`}>
            <span className={`${s.dot} ${s[synth] ?? ''}`} />synthesis
          </div>
        )}
      </div>
    </div>
  )
}
