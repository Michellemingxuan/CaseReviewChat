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
  // Auto-follow the LATEST streaming turn. When a new turn is in flight,
  // the user almost always wants to see THAT turn's progress, not whatever
  // they last clicked. Critical: must use `findLast` (NOT `find`) — when
  // the user asks a follow-up before the previous turn's `turn_done` event
  // has been processed, BOTH turns have status='streaming' simultaneously,
  // and `find` would return the older one and freeze the panel on it.
  // Once the streaming turn completes (status moves off 'streaming'), we
  // fall back to the user's selection.
  const streamingTurn = turns.findLast((t) => t.status === 'streaming') ?? null
  const turn =
    streamingTurn ??
    turns.find((t) => t.turn_id === activeTurnId) ??
    turns[turns.length - 1] ??
    null

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

  // Cached-answer replay short-circuit. When the server replayed a prior
  // identical question's answer (qa_cache hit), no orchestrator / specialist
  // / synthesis work happened — render a slim flow that reflects reality
  // (Question → Chat Agent → Cached Answer) instead of the full L-shape.
  const isCachedReplay = !!turn.final?.flags?.includes('cached_answer_replay')
  if (isCachedReplay) {
    return (
      <div className={s.panel}>
        <div className={s.head}>
          <h3 className={s.title}>Orchestration Flow</h3>
          <StatusPill turn={turn} />
        </div>
        <div className={s.canvas}>
          <div className={`${s.glass} ${s.expanded}`}>
            <div className={s.gridBg} />
            <div className={s.flow}>
              <div className={s.leftWrapper}>
                <div className={s.compactChain}>
                  <div className={s.questionCard}>
                    <div className={s.questionHead}>
                      <span className={s.questionLabel}>Reviewer Question</span>
                    </div>
                    <div className={s.questionText} title={turn.question}>{turn.question}</div>
                  </div>
                  <DownArrow status="done" />
                  <Node
                    name="Chat Agent"
                    role="Screen + scope check"
                    status="done"
                    detail="passed"
                    iconKind="chat"
                    roleStacked
                  />
                  <DownArrow status="done" />
                  <Node
                    name="Cached Answer"
                    role="reused from a prior identical question — no fresh data pull"
                    status="done"
                    iconClass={s.purple}
                    iconKind="cache"
                    detail={turn.duration_ms ? `${(turn.duration_ms / 1000).toFixed(2)}s` : ''}
                    roleStacked
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Partition the orchestrator's tool calls into two branches.
  const allCalls: ToolCall[] = turn.team_plan ?? []
  const reportCalls = allCalls.filter((c) => c.tool === 'report_agent')
  const teamCalls = allCalls.filter((c) => c.tool !== 'report_agent')
  // Within the team branch, split regular specialists from the general
  // (cross-review) specialist so the latter always renders last as a
  // distinct second part of the branch.
  const specialistCalls = teamCalls.filter((c) => c.tool !== 'general_specialist')
  const generalSpecialistCalls = teamCalls.filter((c) => c.tool === 'general_specialist')
  const showTeamDivider = specialistCalls.length > 0 && generalSpecialistCalls.length > 0

  // Branch heights scale with the number of agents in each branch so a
  // 2-specialist team visually reads as bigger than a 1-report side.
  // SLOT is a generous estimate per node so nodes don't need to scroll
  // inside the branch in typical cases. HEADER covers branch padding +
  // header row. The team branch reserves extra space when a divider is
  // shown between the regular specialists and the general specialist.
  const SLOT = 100
  const HEADER = 40
  const reportSlots = Math.max(1, reportCalls.length)
  const teamSlots = Math.max(1, teamCalls.length)
  const reportHeight = HEADER + reportSlots * SLOT
  const teamHeight = HEADER + teamSlots * SLOT + (showTeamDivider ? 28 : 0)
  const branchGap = 10
  const totalBranchH = reportHeight + branchGap + teamHeight
  // Fork tip Y positions as percentages of the branchStack height — the
  // ForkOut/ForkIn SVGs use viewBox 0..100 and stretch vertically to the
  // branchStack, so these percentages line the connector tips up with
  // each branch's vertical center even when the two branches differ in
  // height.
  const reportCenterPct = ((reportHeight / 2) / totalBranchH) * 100
  const teamCenterPct = ((reportHeight + branchGap + teamHeight / 2) / totalBranchH) * 100

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

  /** Has the chat agent given the green light?
   *  - explicitly rejected → ALWAYS stay compact (no orchestrator/branches/synth),
   *    regardless of whether the server emitted a `final` event with the
   *    rejection text. The reject branch in server.py emits final + agent_message
   *    too, so we can't use `turn.final` as a "the orchestrator ran" signal.
   *  - explicitly passed → expand to the full L-shape.
   *  - still screening (no question_check yet) → stay compact, but defensively
   *    expand if downstream activity is somehow already present (e.g. event
   *    ordering anomaly). */
  const chatRejected = turn.question_check?.passed === false
  const chatPassed = turn.question_check?.passed === true
  const orchHasActivity =
    (turn.team_plan?.length ?? 0) > 0 ||
    turn.agent_runs.length > 0
  const showOrchStage = !chatRejected && (chatPassed || orchHasActivity)

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
        <div className={`${s.glass} ${showOrchStage ? s.expanded : ''}`}>
          <div className={s.gridBg} />
          <div className={s.flow}>

            {/* ── Left column ── */}
            <div className={s.leftWrapper}>
              {showOrchStage ? (
                <>
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
                        iconKind="chat"
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
                    iconKind="orchestrator"
                    roleStacked
                  />

                  <div className={s.lowerHalf} />
                </>
              ) : (
                <div className={s.compactChain}>
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
                    detail={
                      turn.question_check
                        ? (turn.question_check.passed ? 'passed' : (turn.question_check.reason || 'rejected'))
                        : ''
                    }
                    iconKind="chat"
                    roleStacked
                  />
                </div>
              )}
            </div>

            {showOrchStage && (
            <>
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
              topY={reportCenterPct}
              bottomY={teamCenterPct}
            />

            {/* ── Branches (middle, stacked) ── */}
            <div className={s.branchStack}>
              <div
                className={`${s.branch} ${s.report} ${reportFailed ? s.failed : ''}`}
                style={{ height: `${reportHeight}px` }}
              >
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
                          iconKind="report"
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

              <div
                className={`${s.branch} ${s.team} ${teamFailed ? s.failed : ''}`}
                style={{ height: `${teamHeight}px` }}
              >
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
                    <>
                      {specialistCalls.map((tc) => {
                        const run = runFor(tc, turn.agent_runs)
                        const status = runStatus(run, turn.status)
                        return (
                          <Node
                            key={tc.call_id}
                            name={tc.tool}
                            role={`${tc.tool} specialist`}
                            iconKind="specialist"
                            status={status}
                            detail={run?.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : ''}
                            errorReason={status === 'error' ? errorReason(run, turn.status) : undefined}
                            subQuestion={tc.sub_question}
                          />
                        )
                      })}
                      {showTeamDivider && (
                        <div className={s.teamDivider}><span>cross-review</span></div>
                      )}
                      {generalSpecialistCalls.map((tc) => {
                        const run = runFor(tc, turn.agent_runs)
                        const status = runStatus(run, turn.status)
                        return (
                          <Node
                            key={tc.call_id}
                            name={tc.tool}
                            role="cross-specialist review"
                            iconKind="general"
                            status={status}
                            detail={run?.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : ''}
                            errorReason={status === 'error' ? errorReason(run, turn.status) : undefined}
                            subQuestion={tc.sub_question}
                          />
                        )
                      })}
                    </>
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
              topY={reportCenterPct}
              bottomY={teamCenterPct}
            />

            {/* ── Synthesis (right) ── */}
            <div className={s.synthCol}>
              <Node
                name="Synthesis"
                role="Reconcile · draft"
                status={synthStatus}
                iconClass={s.purple}
                iconKind="synthesis"
                detail={(() => {
                  const duration = turn.duration_ms
                    ? `${(turn.duration_ms / 1000).toFixed(2)}s total`
                    : ''
                  // Chart-availability hint: when this turn produced charts,
                  // signal it on the synthesis node so the reviewer knows to
                  // check the reasoning trace's [ Charts ] block (charts are
                  // intentionally not embedded in the chat answer anymore).
                  const nCharts = turn.charts?.length ?? 0
                  const chartHint = nCharts > 0
                    ? `📊 ${nCharts} chart${nCharts === 1 ? '' : 's'} in trace`
                    : ''
                  return [chartHint, duration].filter(Boolean).join(' · ')
                })()}
                errorReason={synthStatus === 'error' ? (turn.error || 'pipeline error') : undefined}
                roleStacked
              />
            </div>
            </>
            )}

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
 *    - Spine connecting both tips (x=40, y=topY..bottomY)
 *    - Two arms reaching out to the branches (x=40..100, y=topY and y=bottomY)
 *  topY/bottomY are passed from the caller as percentages so the tips line
 *  up with each branch's vertical center even when branches differ in height. */
function ForkOut({
  topStatus, bottomStatus, topY = 20, bottomY = 80,
}: {
  topStatus: LineStatus; bottomStatus: LineStatus; topY?: number; bottomY?: number
}) {
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
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d={`M 40 50 L 40 ${topY}`} />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d={`M 40 50 L 40 ${bottomY}`} />
        {/* arms reaching out to each branch */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d={`M 40 ${topY} L 100 ${topY}`} />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d={`M 40 ${bottomY} L 100 ${bottomY}`} />
      </svg>
    </div>
  )
}

/** Merge from two branches into Synthesis — mirror of ForkOut. */
function ForkIn({
  topStatus, bottomStatus, tailStatus, topY = 20, bottomY = 80,
}: {
  topStatus: LineStatus; bottomStatus: LineStatus; tailStatus: LineStatus
  topY?: number; bottomY?: number
}) {
  return (
    <div className={s.fork}>
      <svg className={s.forkSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* arms in — keep branch identity */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d={`M 0 ${topY} L 60 ${topY}`} />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d={`M 0 ${bottomY} L 60 ${bottomY}`} />
        {/* spine */}
        <path className={`${s.forkPath} ${s.reportArm} ${pathCls(topStatus)}`}    d={`M 60 ${topY} L 60 50`} />
        <path className={`${s.forkPath} ${s.teamArm} ${pathCls(bottomStatus)}`}   d={`M 60 ${bottomY} L 60 50`} />
        {/* tail to synthesis — neutral status color */}
        <path className={`${s.forkPath} ${pathCls(tailStatus)}`}   d="M 60 50 L 100 50" />
      </svg>
    </div>
  )
}

type IconKind =
  | 'chat'
  | 'orchestrator'
  | 'report'
  | 'specialist'
  | 'general'
  | 'synthesis'
  | 'cache'
  | 'default'

function NodeIcon({ kind }: { kind: IconKind }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (kind) {
    case 'chat':
      // Speech bubble with a tail
      return (
        <svg {...common}>
          <path d="M3 3h10v8H7l-3 3v-3H3z" />
        </svg>
      )
    case 'orchestrator':
      // Share / branching — one source feeding two outputs
      return (
        <svg {...common}>
          <circle cx="4" cy="8" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="3.5" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12.5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M5.5 7.2L10.5 4.4M5.5 8.8L10.5 11.6" />
        </svg>
      )
    case 'report':
      // Document with text lines and a folded corner
      return (
        <svg {...common}>
          <path d="M4 2h5l3 3v9H4z" />
          <path d="M9 2v3h3" />
          <path d="M6 8.5h4M6 10.8h4" />
        </svg>
      )
    case 'specialist':
      // Single person silhouette
      return (
        <svg {...common}>
          <circle cx="8" cy="6" r="2.4" />
          <path d="M3 14c0-2.6 2-4.2 5-4.2s5 1.6 5 4.2" />
        </svg>
      )
    case 'general':
      // Eye — "cross-specialist review"
      return (
        <svg {...common}>
          <path d="M1.5 8c1.3-2.8 3.5-4.5 6.5-4.5s5.2 1.7 6.5 4.5c-1.3 2.8-3.5 4.5-6.5 4.5S2.8 10.8 1.5 8z" />
          <circle cx="8" cy="8" r="1.9" />
        </svg>
      )
    case 'synthesis':
      // Layers — multiple inputs collapsed into one stack
      return (
        <svg {...common}>
          <path d="M8 2L2 5l6 3 6-3z" />
          <path d="M2 8l6 3 6-3" />
          <path d="M2 11l6 3 6-3" />
        </svg>
      )
    case 'cache':
      // Clock — replayed from cache
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3.2l2 1.4" />
        </svg>
      )
    case 'default':
    default:
      return (
        <svg {...common} strokeWidth={1.5}>
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
        </svg>
      )
  }
}

function Node({
  name, role, status, iconClass = '', iconKind = 'default',
  detail, errorReason: errReason, subQuestion, subQuestionFull,
  roleStacked = false,
}: {
  name: string
  role: string
  status: NodeStatus
  iconClass?: string
  iconKind?: IconKind
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
          <NodeIcon kind={iconKind} />
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
