import { useStore } from '../../store'
import type { AgentRun, ToolCall, Turn } from '../../types'
import s from './OrchestrationFlowPanel.module.css'

const EMPTY_TURNS: Turn[] = []

type NodeStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * Orchestration Flow — L-shaped layout:
 *
 *   Question
 *     ↓
 *   Chat Agent
 *     ↓
 *   Orchestrator ──► Report Branch ──┐
 *                                     ├──► Synthesis
 *                    Team Construct ──┘
 *
 * Vertical chain on the left ends at the Orchestrator. From there the flow
 * turns right into the two parallel branches (curated reports + specialist
 * team), both feeding the Synthesis node on the far right.
 */
export function OrchestrationFlowPanel({ caseId }: { caseId: string | null }) {
  const turns = useStore((st) => (caseId ? st.turns[caseId] : undefined)) ?? EMPTY_TURNS
  const activeTurnId = useStore((st) => (caseId ? st.activeTurnId[caseId] : null))
  const turn = turns.find((t) => t.turn_id === activeTurnId) ?? turns[turns.length - 1] ?? null

  if (!turn) {
    return (
      <div className={s.panel}>
        <div className={s.head}><h3 className={s.title}>Orchestration Flow</h3></div>
        <div className={s.empty}>
          <strong>No turn selected</strong>
          The agent graph will render here as soon as a question is asked.
        </div>
      </div>
    )
  }

  // Partition the orchestrator's tool calls into two branches.
  const allCalls: ToolCall[] = turn.team_plan ?? []
  const reportCalls = allCalls.filter((c) => c.tool === 'report_agent')
  const teamCalls = allCalls.filter((c) => c.tool !== 'report_agent')

  // Stage statuses derived from the turn.
  const chatStatus: NodeStatus =
    turn.question_check ? 'done' : turn.status === 'streaming' ? 'running' : 'idle'

  const orchStatus: NodeStatus =
    allCalls.length > 0 ? 'done'
      : turn.question_check?.passed === false ? 'idle'
      : turn.question_check ? 'running'
      : 'idle'

  const reportStatus = branchStatus(reportCalls, turn.agent_runs, turn.status)
  const teamStatus = branchStatus(teamCalls, turn.agent_runs, turn.status)
  const reportFailed = reportCalls.some((c) => runStatus(runFor(c, turn.agent_runs), turn.status) === 'error')
  const teamFailed = teamCalls.some((c) => runStatus(runFor(c, turn.agent_runs), turn.status) === 'error')

  const synthStatus: NodeStatus =
    turn.final ? 'done'
      : turn.status === 'error' ? 'error'
      : (allCalls.length > 0 && allCalls.every((c) => runFor(c, turn.agent_runs)?.payload)) ? 'running'
      : 'idle'

  const branchesToSynth: 'done' | 'active' | 'idle' | 'error' =
    synthStatus === 'error' || (reportFailed && teamFailed) ? 'error'
      : synthStatus === 'done' ? 'done'
      : (reportStatus === 'done' || teamStatus === 'done' || synthStatus === 'running') ? 'active'
      : 'idle'

  const handleJumpToChat = () => {
    const sel = `[data-turn-id="${turn.turn_id}"][data-role="reviewer"]`
    const target = document.querySelector(sel) as HTMLElement | null
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('flash-highlight')
      setTimeout(() => target.classList.remove('flash-highlight'), 1500)
    }
  }

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <h3 className={s.title}>Orchestration Flow</h3>
        <StatusPill turn={turn} />
      </div>

      <div className={s.canvas}>
        <div className={s.glass}>
          <div className={s.gridBg} />
          <div className={s.flow}>

            {/* ── Left column: upper-chain → Orchestrator (centered vertically) ── */}
            <div className={s.leftWrapper}>
              <div className={s.upperHalf}>
                <div className={s.verticalChain}>
                  <div className={s.questionCard}>
                    <div className={s.questionHead}>
                      <span className={s.questionLabel}>Reviewer Question</span>
                      <button className={s.chatJump} onClick={handleJumpToChat} title="Jump to this question in the chat">
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 2v10M4 8l4 4 4-4" />
                        </svg>
                        chat
                      </button>
                    </div>
                    <div className={s.questionText} title={turn.question}>{turn.question}</div>
                  </div>

                  <DownArrow status={chatStatus === 'done' ? 'done' : chatStatus === 'running' ? 'active' : 'idle'} />

                  <Node
                    name="Chat Agent"
                    role="Screen + scope check"
                    status={chatStatus}
                    detail={turn.question_check ? (turn.question_check.passed ? 'passed' : 'rejected') : ''}
                    roleStacked
                  />

                  <DownArrow status={chatStatus === 'done' ? (orchStatus === 'done' ? 'done' : orchStatus === 'running' ? 'active' : 'idle') : 'idle'} />
                </div>
              </div>

              {/* Orchestrator is the center pivot — fork bifurcates from its right side */}
              <Node
                name="Orchestrator"
                role={allCalls.length > 0 ? `Dispatched ${allCalls.length}` : 'Planning…'}
                status={orchStatus}
                detail=""
                roleStacked
              />

              <div className={s.lowerHalf} />
            </div>

            {/* Fork — orchestrator bifurcates to Report + Team branches */}
            <ForkOut
              topStatus={
                reportFailed ? 'error'
                  : reportStatus === 'done' ? 'done'
                  : (orchStatus === 'done' || reportStatus === 'running') ? 'active'
                  : 'idle'
              }
              bottomStatus={
                teamFailed ? 'error'
                  : teamStatus === 'done' ? 'done'
                  : (orchStatus === 'done' || teamStatus === 'running') ? 'active'
                  : 'idle'
              }
            />

            {/* ── Branches (middle, stacked) ── */}
            <div className={s.branchStack}>
              <div className={`${s.branch} ${s.report} ${reportFailed ? s.failed : ''}`}>
                <div className={s.branchHeader}>
                  <span className={`${s.branchLabel} ${s.report}`}>
                    Report Branch{reportFailed ? ' · failed' : ''}
                  </span>
                  <span className={s.branchCount}>
                    {reportCalls.length === 0 ? 'idle' : `${reportCalls.length} call${reportCalls.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className={s.nodeStack}>
                  {reportCalls.length === 0 ? (
                    <div className={s.nodePlaceholder}>not dispatched on this turn</div>
                  ) : (
                    reportCalls.map((tc) => {
                      const run = runFor(tc, turn.agent_runs)
                      const status = runStatus(run, turn.status)
                      return (
                        <Node
                          key={tc.call_id}
                          name="report_agent"
                          role="curated reports"
                          iconClass={s.teal}
                          status={status}
                          detail={run?.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : ''}
                          errorReason={status === 'error' ? errorReason(run, turn.status) : undefined}
                          subQuestion={tc.sub_question}
                        />
                      )
                    })
                  )}
                </div>
              </div>

              <div className={`${s.branch} ${s.team} ${teamFailed ? s.failed : ''}`}>
                <div className={s.branchHeader}>
                  <span className={`${s.branchLabel} ${s.team}`}>
                    Team Construction{teamFailed ? ' · failed' : ''}
                  </span>
                  <span className={s.branchCount}>
                    {teamCalls.length === 0 ? 'idle' : `${teamCalls.length} specialist${teamCalls.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className={s.nodeStack}>
                  {teamCalls.length === 0 ? (
                    <div className={s.nodePlaceholder}>no specialists dispatched</div>
                  ) : (
                    teamCalls.map((tc) => {
                      const run = runFor(tc, turn.agent_runs)
                      const isGeneral = tc.tool === 'general_specialist'
                      const status = runStatus(run, turn.status)
                      return (
                        <Node
                          key={tc.call_id}
                          name={tc.tool}
                          role={isGeneral ? 'cross-specialist review' : `${tc.tool} specialist`}
                          iconClass={isGeneral ? s.amber : ''}
                          status={status}
                          detail={run?.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : ''}
                          errorReason={status === 'error' ? errorReason(run, turn.status) : undefined}
                          subQuestion={tc.sub_question}
                        />
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Merge — both branches converge into Synthesis */}
            <ForkIn
              topStatus={
                reportFailed ? 'error'
                  : reportStatus === 'done' ? 'done'
                  : reportStatus === 'running' ? 'active'
                  : 'idle'
              }
              bottomStatus={
                teamFailed ? 'error'
                  : teamStatus === 'done' ? 'done'
                  : teamStatus === 'running' ? 'active'
                  : 'idle'
              }
              tailStatus={branchesToSynth}
            />

            {/* ── Synthesis (right) ── */}
            <div className={s.synthCol}>
              <Node
                name="Synthesis"
                role="Reconcile · draft"
                status={synthStatus}
                iconClass={s.purple}
                detail={turn.duration_ms ? `${(turn.duration_ms / 1000).toFixed(2)}s total` : ''}
                errorReason={synthStatus === 'error' ? (turn.error || 'pipeline error') : undefined}
                roleStacked
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function runFor(tc: ToolCall, runs: AgentRun[]): AgentRun | undefined {
  return runs.find((r) => r.call_id === tc.call_id)
}

function isErrorPayload(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  if ('error' in obj && obj.error) return true
  if ('unavailable' in obj && obj.unavailable === true) return true
  return false
}

function runStatus(run: AgentRun | undefined, turnStatus: Turn['status']): NodeStatus {
  if (!run) return 'idle'
  if (run.payload) {
    if (isErrorPayload(run.payload)) return 'error'
    return 'done'
  }
  if (turnStatus === 'done' || turnStatus === 'error') return 'error'
  return 'running'
}

function errorReason(run: AgentRun | undefined, turnStatus: Turn['status']): string {
  if (!run) return 'not started'
  if (run.payload) {
    const obj = run.payload as Record<string, unknown>
    if (typeof obj.error === 'string' && obj.error) return String(obj.error)
    if (obj.unavailable === true) return 'data unavailable'
    return 'agent error'
  }
  if (turnStatus === 'error') return 'pipeline aborted'
  return 'no result'
}

function branchStatus(calls: ToolCall[], runs: AgentRun[], turnStatus: Turn['status']): NodeStatus {
  if (calls.length === 0) return 'idle'
  const statuses = calls.map((c) => runStatus(runFor(c, runs), turnStatus))
  if (statuses.every((st) => st === 'error')) return 'error'
  if (statuses.every((st) => st === 'done')) return 'done'
  if (statuses.some((st) => st === 'running')) return 'running'
  return 'idle'
}


function StatusPill({ turn }: { turn: Turn }) {
  const cls =
    turn.status === 'streaming' ? s.streaming :
    turn.status === 'error'     ? s.error :
    turn.status === 'done'      ? s.done :
                                  s.idle
  const label =
    turn.status === 'streaming' ? 'streaming' :
    turn.status === 'error'     ? 'error' :
    turn.status === 'done'      ? 'done' : 'idle'
  return (
    <span className={`${s.statusPill} ${cls}`}>
      <span className={s.dot}></span>
      {label}{turn.duration_ms ? ` · ${(turn.duration_ms / 1000).toFixed(2)}s` : ''}
    </span>
  )
}

function DownArrow({ status }: { status: 'done' | 'active' | 'idle' | 'error' }) {
  const cls =
    status === 'done'  ? s.done :
    status === 'active' ? s.active :
    status === 'error' ? s.error : ''
  return (
    <div className={`${s.downArrow} ${cls}`}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2v10M4 8l4 4 4-4" />
      </svg>
    </div>
  )
}

type LineStatus = 'done' | 'active' | 'idle' | 'error'

function pathCls(status: LineStatus) {
  return status === 'done' ? s.done
    : status === 'error' ? s.error
    : status === 'active' ? s.active : ''
}

/** Fork out of the orchestrator into two branches.
 *  Layout in viewBox 0..100 horizontal × 0..100 vertical:
 *    - Stub from left edge to the spine (x=0..40, y=50)
 *    - Spine connecting both tips (x=40, y=20..80)
 *    - Two arms reaching out to the branches (x=40..100, y=20 and y=80) */
function ForkOut({ topStatus, bottomStatus }: { topStatus: LineStatus; bottomStatus: LineStatus }) {
  // Stub colour reflects whichever branch is most progressed (any active/done dominates idle).
  const stubStatus: LineStatus =
    (topStatus === 'error' && bottomStatus === 'error') ? 'error'
      : (topStatus === 'done' || bottomStatus === 'done') ? 'done'
      : (topStatus === 'active' || bottomStatus === 'active') ? 'active'
      : 'idle'
  return (
    <div className={s.fork}>
      <svg className={s.forkSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* stub from orchestrator — neutral status color */}
        <path className={`${s.forkPath} ${pathCls(stubStatus)}`} d="M 0 50 L 40 50" />
        {/* spine — top half tinted teal (report), bottom half tinted indigo (team) */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d="M 40 50 L 40 20" />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d="M 40 50 L 40 80" />
        {/* arms reaching out to each branch */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d="M 40 20 L 100 20" />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d="M 40 80 L 100 80" />
      </svg>
    </div>
  )
}

/** Merge from two branches into Synthesis — mirror of ForkOut. */
function ForkIn({
  topStatus, bottomStatus, tailStatus,
}: {
  topStatus: LineStatus; bottomStatus: LineStatus; tailStatus: LineStatus
}) {
  return (
    <div className={s.fork}>
      <svg className={s.forkSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* arms in — keep branch identity */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d="M 0 20 L 60 20" />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d="M 0 80 L 60 80" />
        {/* spine */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d="M 60 20 L 60 50" />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d="M 60 80 L 60 50" />
        {/* tail to synthesis — neutral status color */}
        <path className={`${s.forkPath} ${pathCls(tailStatus)}`}   d="M 60 50 L 100 50" />
      </svg>
    </div>
  )
}

function Node({
  name, role, status, iconClass = '', detail, errorReason: errReason, subQuestion, subQuestionFull,
  roleStacked = false,
}: {
  name: string
  role: string
  status: NodeStatus
  iconClass?: string
  detail: string
  errorReason?: string
  subQuestion?: string
  subQuestionFull?: string
  /** When true, role renders as a second line below the name (used for the
   *  fixed nodes — Chat Agent, Orchestrator, Synthesis — where the role is a
   *  static descriptor). When false (default), role renders inline next to
   *  the name with a "·" separator (used for branch specialists where the
   *  role labels the agent's domain). */
  roleStacked?: boolean
}) {
  const statusCls =
    status === 'done'    ? s.done :
    status === 'running' ? s.running :
    status === 'error'   ? s.error : s.idle
  return (
    <div className={`${s.node} ${statusCls}`} title={errReason ? `Failed: ${errReason}` : undefined}>
      <div className={s.nodeRow1}>
        <span className={`${s.nodeIcon} ${iconClass}`}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
          </svg>
        </span>
        {roleStacked ? (
          <span className={s.nodeName} title={name} style={{ flex: 1 }}>{name}</span>
        ) : (
          <span className={s.nodeMain}>
            <span className={s.nodeName} title={name}>{name}</span>
            <span className={s.nodeRoleInline} title={role}>{role}</span>
          </span>
        )}
        <span className={`${s.nodeStatus} ${statusCls}`}></span>
      </div>
      {roleStacked && (
        <div className={s.nodeRole} title={role}>{role}</div>
      )}
      {subQuestion && (
        <div className={s.subQuestion} title={subQuestionFull || subQuestion}>{subQuestion}</div>
      )}
      {status === 'error' && errReason && (
        <div className={s.errorDetail} title={errReason}>{errReason}</div>
      )}
      {detail && (
        <div className={s.nodeFoot}>
          <span className={s.nodeTime}>{detail}</span>
        </div>
      )}
    </div>
  )
}
