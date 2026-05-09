import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../../store'
import type {
  AgentRun,
  ChartInfo,
  ReportDraftPayload,
  ReviewReportPayload,
  SpecialistPayload,
  Turn,
} from '../../types'
import s from './AuditTracePanel.module.css'

// Stable empty array reference — returning `[]` from a Zustand selector each
// call would create a new reference and trigger an infinite re-render loop.
const EMPTY_TURNS: Turn[] = []

/**
 * Audit trace — renders the structured reasoning of a single Turn as the
 * bracketed [QUESTION CHECK] / [TEAM CONSTRUCTION] / [SPECIALIST ANALYSIS] /
 * [REPORT AGENT ANALYSIS] / [FINAL SYNTHESIS] blocks. The shape mirrors
 * `AgenticSys_v2/notebooks/run_question_suite.py:_render_turn_md`.
 *
 * Streams in real time: each agent's [SPECIALIST ANALYSIS] block appears as
 * its `agent_completed` event lands, not all at once at the end.
 */
export function AuditTracePanel({ caseId }: { caseId: string | null }) {
  const turns = useStore((st) => (caseId ? st.turns[caseId] : undefined)) ?? EMPTY_TURNS
  const activeTurnId = useStore((st) => (caseId ? st.activeTurnId[caseId] : null))
  const setActiveTurn = useStore((st) => st.setActiveTurn)

  // Auto-follow the LATEST streaming turn. Critical: must use `findLast`
  // (NOT `find`) — when the user asks a follow-up before the previous
  // turn's `turn_done` has been processed, BOTH turns have
  // status='streaming' for an instant, and `find` would return the older
  // one and freeze this panel on it. Falls back to the user's clicked turn
  // (or the last turn) once streaming completes.
  const streamingTurn = turns.findLast((t) => t.status === 'streaming') ?? null
  const turn =
    streamingTurn ??
    turns.find((t) => t.turn_id === activeTurnId) ??
    turns[turns.length - 1] ??
    null

  if (!caseId) {
    return (
      <div className={s.panel}>
        <div className={s.head}>
          <div className={s.headRow}><h3 className={s.title}>Reasoning Trace</h3></div>
        </div>
        <div className={s.empty}><strong>Select a case</strong>The trace will appear once you ask a question.</div>
      </div>
    )
  }

  if (!turn) {
    return (
      <div className={s.panel}>
        <div className={s.head}>
          <div className={s.headRow}><h3 className={s.title}>Reasoning Trace</h3></div>
        </div>
        <div className={s.empty}><strong>No turns yet</strong>Ask a question to see the agentic reasoning unfold.</div>
      </div>
    )
  }

  const idx = turns.findIndex((t) => t.turn_id === turn.turn_id)
  const goPrev = () => idx > 0 && caseId && setActiveTurn(caseId, turns[idx - 1].turn_id)
  const goNext = () => idx < turns.length - 1 && caseId && setActiveTurn(caseId, turns[idx + 1].turn_id)

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div className={s.headRow}>
          <h3 className={s.title}>Reasoning Trace</h3>
          <span className={s.turnNav}>
            <button className={s.turnArrow} onClick={goPrev} disabled={idx <= 0}>‹</button>
            <span>Turn {idx + 1} of {turns.length}</span>
            <button className={s.turnArrow} onClick={goNext} disabled={idx >= turns.length - 1}>›</button>
          </span>
        </div>
        <div className={s.headQuestion} title={turn.question}>{turn.question}</div>
      </div>

      {turn.status === 'streaming' && (
        <div className={s.streamingNote}><span className={s.dot}></span>streaming…</div>
      )}

      <div className={s.stream}>
        <QuestionCheckBlock turn={turn} />
        {turn.final?.flags?.includes('cached_answer_replay') ? (
          // Cached-replay short-circuit — no orchestrator / specialist work
          // happened, so skip Team Construction + per-agent blocks. The
          // [Final Synthesis] block (rendered below) will show the cached
          // answer directly with the cached_answer_replay flag visible.
          <CachedReplayBlock />
        ) : (
          <>
            <TeamConstructionBlock turn={turn} />
            {turn.agent_runs.map((r) => {
              // Filter charts whose `specialist` matches this agent's `tool`
              // — they appear inline at the bottom of THIS specialist's
              // block so each plot lives next to the analysis it came from.
              const runCharts = (turn.charts ?? []).filter(
                (c) => c.specialist === r.tool
              )
              return <AgentBlock key={r.call_id} run={r} charts={runCharts} />
            })}
            {/* Orphan charts whose specialist didn't show up in agent_runs
                — rare; surface them as a fallback so nothing is silently lost. */}
            {(() => {
              const known = new Set(turn.agent_runs.map((r) => r.tool))
              const orphan = (turn.charts ?? []).filter((c) => !known.has(c.specialist))
              return orphan.length > 0 ? <ChartsBlock charts={orphan} /> : null
            })()}
          </>
        )}
        <FinalSynthesisBlock turn={turn} />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Charts-block. Click-to-open buttons for every KP this turn that has a
 * rendered chart, grouped by specialist. Charts come in via the `chart`
 * SSE event — they're NOT inlined in the chat answer (kept clean). Each
 * button shows the chart's topic + claim; clicking opens a full-size
 * preview in a lightweight modal.
 */
function ChartsBlock({ charts }: { charts: ChartInfo[] }) {
  const [open, setOpen] = useState<ChartInfo | null>(null)
  if (!charts.length) return null

  // Group by specialist for visual scanning.
  const bySpecialist = new Map<string, ChartInfo[]>()
  for (const c of charts) {
    const list = bySpecialist.get(c.specialist) ?? []
    list.push(c)
    bySpecialist.set(c.specialist, list)
  }

  const kindIcon = (kind: string) =>
    kind === 'trend' ? '📈' : kind === 'share' ? '📊' : kind === 'bar' ? '📉' : '🔎'

  return (
    <div className={s.block}>
      <div className={`${s.bracket} ${s.charts}`}>
        <span className={s.tag}>[ Charts ]</span>
        <span className={s.meta}>
          {charts.length} chart{charts.length === 1 ? '' : 's'} this turn
        </span>
      </div>
      {[...bySpecialist.entries()].map(([specialist, list]) => (
        <div key={specialist} className={s.chartsGroup}>
          <p className={s.chartsGroupHead}>{specialist}</p>
          <div className={s.chartsRow}>
            {list.map((c) => (
              <button
                key={`${c.specialist}/${c.topic}`}
                type="button"
                className={s.chartButton}
                title={c.claim || c.topic}
                onClick={() => setOpen(c)}
              >
                <span className={s.chartIcon}>{kindIcon(c.kind)}</span>
                <span className={s.chartLabel}>
                  <span className={s.chartTopic}>
                    {c.topic.replace(/_/g, ' ')}
                  </span>
                  {c.claim ? (
                    <span className={s.chartClaim}>{c.claim}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {open ? (
        <ChartLightbox chart={open} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  )
}

function ChartLightbox({ chart, onClose }: { chart: ChartInfo; onClose: () => void }) {
  return (
    <div className={s.lightboxBackdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={s.lightboxBody} onClick={(e) => e.stopPropagation()}>
        <div className={s.lightboxHead}>
          {/* Compact head: just the claim (it carries both topic context AND
              the actual finding) plus a close button. The chart-button
              already showed the topic name; repeating it here was
              redundant. */}
          {chart.claim ? <p className={s.lightboxClaim}>{chart.claim}</p> : null}
          <button type="button" className={s.lightboxClose} onClick={onClose}>×</button>
        </div>
        <img className={s.lightboxImage} src={chart.url} alt={chart.topic} />
        {chart.source_call ? (
          <p className={s.lightboxSource}>
            <span className={s.k}>{chart.specialist} · via:</span>{' '}
            <code>{chart.source_call}</code>
          </p>
        ) : (
          <p className={s.lightboxSource}>
            <span className={s.k}>{chart.specialist}</span>
          </p>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

function QuestionCheckBlock({ turn }: { turn: Turn }) {
  const qc = turn.question_check
  return (
    <div className={s.block}>
      <div className={`${s.bracket} ${s.questionCheck}`}>
        <span className={s.tag}>[ Question Check ]</span>
        <span className={s.meta}>chat_agent</span>
      </div>
      {!qc ? (
        <p className={`${s.line} ${s.dim}`}>screening…</p>
      ) : (
        <>
          <p className={s.bullet}>
            <span className={s.k}>Safety / PII screen: </span>
            <span className={`${s.v} ${qc.passed ? s.pos : s.neg}`}>
              {qc.passed ? 'passed' : `rejected — ${qc.reason || 'no reason given'}`}
            </span>
          </p>
          {qc.redacted_question && qc.redacted_question !== turn.question && (
            <p className={s.sub}>
              <span className={s.k}>Redacted to: </span>
              <code>{qc.redacted_question}</code>
            </p>
          )}
          <p className={s.bullet}>
            <span className={s.k}>Scope check: </span>
            <span className={`${s.v} ${qc.in_scope ? s.pos : s.neg}`}>
              {qc.in_scope ? 'in scope' : 'out of scope'}
            </span>
          </p>
          <p className={s.bullet}>
            <span className={s.k}>Outcome: </span>
            <span className={s.v}>{outcomeLabel(qc.outcome)}</span>
          </p>
        </>
      )}
    </div>
  )
}

function CachedReplayBlock() {
  return (
    <div className={s.block}>
      <div className={`${s.bracket} ${s.team}`}>
        <span className={s.tag}>[ Cached Answer ]</span>
        <span className={s.meta}>orchestrator skipped</span>
      </div>
      <p className={`${s.line} ${s.dim}`}>
        This question is identical to one already answered earlier in this
        session. The orchestrator was not invoked; no report agent, specialists,
        or general-specialist review ran for this turn. The Final Synthesis
        below shows the previously-produced answer verbatim.
      </p>
    </div>
  )
}

function TeamConstructionBlock({ turn }: { turn: Turn }) {
  const tp = turn.team_plan
  if (!turn.question_check?.passed) return null
  return (
    <div className={s.block}>
      <div className={`${s.bracket} ${s.team}`}>
        <span className={s.tag}>[ Team Construction ]</span>
        <span className={s.meta}>orchestrator</span>
      </div>
      {!tp || tp.length === 0 ? (
        <p className={`${s.line} ${s.dim}`}>planning…</p>
      ) : (
        <>
          <p className={`${s.line} ${s.dim}`}>{teamSummary(tp)}</p>
          {tp.map((c) => (
            <div key={c.call_id}>
              <p className={s.bullet}>
                <span className={s.tool}>{c.tool}</span>
                <span className={s.k}> ({roleFor(c.tool)})</span>
              </p>
              <p className={s.sub}>
                <span className={s.k}>sub-question: </span>{c.sub_question}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// Compose the team-summary line shown above the per-call list. Splits the
// orchestrator's tool calls into three buckets — domain specialists (the
// "team"), the report agent (auxiliary that pulls curated reports), and the
// general specialist (cross-domain reviewer that compares specialist outputs).
// Mirrors `notebooks/run_question_suite.py:_render_turn_md` so notebook +
// audit panel use the same vocabulary.
function teamSummary(tp: NonNullable<Turn['team_plan']>): React.ReactNode {
  const specialists = tp.filter(
    (c) => c.tool !== 'report_agent' && c.tool !== 'general_specialist'
  )
  const hasReport = tp.some((c) => c.tool === 'report_agent')
  const hasGeneral = tp.some((c) => c.tool === 'general_specialist')
  const n = specialists.length

  const parts: React.ReactNode[] = []
  if (hasReport) {
    parts.push(<>Orchestrator consulted the <strong>Report agent</strong></>)
    parts.push(' and ')
  } else {
    parts.push('Orchestrator ')
  }
  parts.push(
    <>constructed a team of <strong>{n} domain specialist{n === 1 ? '' : 's'}</strong></>
  )
  if (n > 0) {
    parts.push(
      <span className={s.k}> ({specialists.map((c) => c.tool).join(', ')})</span>
    )
  }
  if (hasGeneral) {
    parts.push(<> with <strong>1 general specialist</strong> for cross-domain review</>)
  }
  parts.push(' on this turn:')
  return parts.map((p, i) => <span key={i}>{p}</span>)
}

function AgentBlock({ run, charts = [] }: { run: AgentRun; charts?: ChartInfo[] }) {
  const { tool, payload, duration_ms } = run
  const labelMap: Record<string, { tag: string; cls: string }> = {
    report_agent:       { tag: '[ Report Agent Analysis ]',         cls: s.report },
    general_specialist: { tag: '[ General Specialist Review ]',     cls: s.review },
  }
  const label = labelMap[tool] ?? { tag: `[ Specialist Analysis — ${tool} ]`, cls: s.specialist }

  return (
    <div className={s.block}>
      <div className={`${s.bracket} ${label.cls}`}>
        <span className={s.tag}>{label.tag}</span>
        <span className={s.meta}>
          {tool}{duration_ms !== undefined ? ` · ${(duration_ms / 1000).toFixed(2)}s` : ' · running…'}
        </span>
      </div>
      {!payload ? (
        <p className={`${s.line} ${s.dim}`}>working…</p>
      ) : tool === 'report_agent' ? (
        <ReportDraftBody payload={payload as ReportDraftPayload} />
      ) : tool === 'general_specialist' ? (
        <ReviewReportBody payload={payload as ReviewReportPayload} />
      ) : (
        <SpecialistOutputBody payload={payload as SpecialistPayload} />
      )}
      {/* Inline chart row — lives at the bottom of THIS specialist's block
          so every chart stays next to the analysis it came from, not in a
          centralized list at the end of the trace. */}
      {charts.length > 0 ? <InlineCharts charts={charts} /> : null}
    </div>
  )
}

function InlineCharts({ charts }: { charts: ChartInfo[] }) {
  const [open, setOpen] = useState<ChartInfo | null>(null)
  const kindIcon = (kind: string) =>
    kind === 'trend' ? '📈' : kind === 'share' ? '📊' : kind === 'bar' ? '📉' : '🔎'
  return (
    <>
      <p className={s.bullet}><span className={s.k}>Charts:</span></p>
      <div className={s.chartsRow}>
        {charts.map((c) => (
          <button
            key={`${c.specialist}/${c.topic}`}
            type="button"
            className={s.chartButton}
            title={c.claim || c.topic}
            onClick={() => setOpen(c)}
          >
            <span className={s.chartIcon}>{kindIcon(c.kind)}</span>
            <span className={s.chartLabel}>
              <span className={s.chartTopic}>{c.topic.replace(/_/g, ' ')}</span>
              {c.claim ? <span className={s.chartClaim}>{c.claim}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {open ? <ChartLightbox chart={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

function SpecialistOutputBody({ payload }: { payload: SpecialistPayload }) {
  return (
    <>
      {payload.findings && (
        <div className={s.bullet}>
          <span className={s.k}>Findings:</span>
          <ExpandableMarkdown text={payload.findings} cap={600} />
        </div>
      )}
      {payload.evidence?.length > 0 && (
        <>
          <p className={s.bullet}><span className={s.k}>Evidence:</span></p>
          <ExpandableList
            items={payload.evidence}
            cap={5}
            render={(e, i) => <ExpandableLine key={i} text={e} cap={300} />}
          />
        </>
      )}
      {payload.implications?.length > 0 && (
        <>
          <p className={s.bullet}><span className={s.k}>Implications:</span></p>
          <ExpandableList
            items={payload.implications}
            cap={3}
            render={(e, i) => <ExpandableLine key={i} text={e} cap={300} />}
          />
        </>
      )}
      {payload.data_gaps?.length > 0 && (
        <>
          <p className={s.bullet}><span className={s.k}>Data gaps:</span></p>
          <ExpandableList
            items={payload.data_gaps}
            cap={3}
            render={(e, i) => <ExpandableLine key={i} text={e} cap={300} />}
          />
        </>
      )}
    </>
  )
}

function ReportDraftBody({ payload }: { payload: ReportDraftPayload }) {
  return (
    <>
      <p className={s.bullet}>
        <span className={s.k}>Report coverage: </span>
        <span className={`${s.v} ${payload.coverage === 'explicit' ? s.pos : ''}`}>{payload.coverage}</span>
      </p>
      {payload.files_consulted?.length > 0 && (
        <p className={s.bullet}>
          <span className={s.k}>Files consulted: </span>
          {payload.files_consulted.map((f, i) => (
            <span key={i}>{i > 0 ? ', ' : ''}<code>{f}</code></span>
          ))}
        </p>
      )}
      {payload.answer && (
        <div className={s.bullet}>
          <span className={s.k}>Report's answer:</span>
          <ExpandableMarkdown text={payload.answer} cap={600} />
        </div>
      )}
      {payload.evidence_excerpts?.length > 0 && (
        <>
          <p className={s.bullet}><span className={s.k}>Quoted from the reports:</span></p>
          <ExpandableQuote items={payload.evidence_excerpts} cap={5} perItemCap={250} />
        </>
      )}
    </>
  )
}

function ReviewReportBody({ payload }: { payload: ReviewReportPayload }) {
  const resolved = payload.resolved ?? []
  const open = payload.open_conflicts ?? []
  const insights = payload.cross_domain_insights ?? []
  return (
    <>
      {resolved.length > 0 && (
        <p className={s.bullet}><span className={s.k}>Resolved contradictions: </span><span className={s.v}>{resolved.length}</span></p>
      )}
      {open.length > 0 && (
        <p className={s.bullet}><span className={s.k}>Open conflicts: </span><span className={s.v}>{open.length}</span></p>
      )}
      {insights.length > 0 && (
        <>
          <p className={s.bullet}><span className={s.k}>Cross-domain insights:</span></p>
          <ExpandableList
            items={insights}
            cap={3}
            render={(e, i) => <ExpandableLine key={i} text={e} cap={250} />}
          />
        </>
      )}
      {resolved.length === 0 && open.length === 0 && insights.length === 0 && (
        <p className={`${s.line} ${s.dim}`}>(no contradictions / cross-domain insights)</p>
      )}
    </>
  )
}

function FinalSynthesisBlock({ turn }: { turn: Turn }) {
  if (!turn.final && turn.status === 'streaming') return null
  return (
    <div className={s.block}>
      <div className={`${s.bracket} ${s.synthesis}`}>
        <span className={s.tag}>[ Final Synthesis ]</span>
        <span className={s.meta}>
          synthesis{turn.duration_ms ? ` · ${(turn.duration_ms / 1000).toFixed(2)}s total` : ''}
        </span>
      </div>
      <div className={s.final}>
        <span className={s.answerTag}>Answer</span>
        <p>{turn.final?.answer ?? turn.error ?? '(no answer)'}</p>
        {turn.final?.flags && turn.final.flags.length > 0 && (
          <>
            <span className={s.answerTag} style={{ marginTop: 10 }}>Flags</span>
            {turn.final.flags.map((f, i) => (
              <p key={i} style={{ fontSize: 12.5, marginTop: 4 }}>· {f}</p>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function roleFor(tool: string): string {
  if (tool === 'report_agent') return 'report agent'
  if (tool === 'general_specialist') return 'cross-specialist reviewer'
  return `${tool} specialist`
}

function outcomeLabel(o: Turn['outcome']): string {
  switch (o) {
    case 'ok':                  return 'Completed'
    case 'screen_rejected':     return 'Rejected at safety / scope screen'
    case 'out_of_scope':        return 'Allowed in but ruled out of scope'
    case 'orchestrator_error':  return 'Pipeline error'
    default:                    return String(o ?? '')
  }
}

function excerpt(s: string, max = 400): string {
  if (!s) return ''
  const t = String(s).trim()
  return t.length <= max ? t : t.slice(0, max).trimEnd() + ' …'
}

// ── Expandable display helpers ─────────────────────────────────────────────
//
// Backend sends the full payload — these components only cap the *displayed*
// portion so the panel stays scannable, with a "Show more" toggle that
// reveals the rest. Each instance owns its own state, so expanding one
// specialist's findings doesn't expand another's.

const toggleStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  marginLeft: 4,
  color: '#6366f1',
  cursor: 'pointer',
  fontSize: 'inherit',
  fontWeight: 500,
  textDecoration: 'underline dotted',
}

function ExpandableText({ text, cap }: { text: string; cap: number }) {
  const [open, setOpen] = useState(false)
  const t = String(text || '').trim()
  if (!t) return null
  const overflows = t.length > cap
  if (!overflows) return <span className={s.v}>{t}</span>
  return (
    <span className={s.v}>
      {open ? t : t.slice(0, cap).trimEnd() + ' …'}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={toggleStyle}
      >
        {open ? 'show less' : 'show more'}
      </button>
    </span>
  )
}

// Markdown variant — for fields where the LLM produces bullet lists / headings
// (specialist `findings`, report agent `answer`). Renders through ReactMarkdown
// so `- item` / `1. item` become real <ul>/<ol>. Keeps the same expand/collapse
// behavior. Must be wrapped in a <div> by the caller (ReactMarkdown emits block
// elements, which are illegal inside <p>).
function ExpandableMarkdown({ text, cap }: { text: string; cap: number }) {
  const [open, setOpen] = useState(false)
  const t = String(text || '').trim()
  if (!t) return null
  const overflows = t.length > cap
  const display = !overflows || open ? t : t.slice(0, cap).trimEnd() + ' …'
  return (
    <div className={s.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
      {overflows && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={toggleStyle}
        >
          {open ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  )
}

function ExpandableLine({ text, cap }: { text: string; cap: number }) {
  const [open, setOpen] = useState(false)
  const t = String(text || '').trim()
  if (!t) return null
  const overflows = t.length > cap
  return (
    <p className={s.sub}>
      {!overflows || open ? t : t.slice(0, cap).trimEnd() + ' …'}
      {overflows && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={toggleStyle}
        >
          {open ? 'show less' : 'show more'}
        </button>
      )}
    </p>
  )
}

function ExpandableList<T>({
  items, cap, render,
}: {
  items: T[]
  cap: number
  render: (item: T, i: number) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!items?.length) return null
  const visible = open ? items : items.slice(0, cap)
  const hidden = items.length - cap
  return (
    <>
      {visible.map((item, i) => render(item, i))}
      {hidden > 0 && (
        <p className={s.sub}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            style={toggleStyle}
          >
            {open ? 'show fewer' : `… and ${hidden} more`}
          </button>
        </p>
      )}
    </>
  )
}

function ExpandableQuote({
  items, cap, perItemCap,
}: { items: string[]; cap: number; perItemCap: number }) {
  const [open, setOpen] = useState(false)
  if (!items?.length) return null
  const visible = open ? items : items.slice(0, cap)
  const hidden = items.length - cap
  const body = visible
    .map((e) => (open ? String(e || '').trim() : excerpt(e, perItemCap)))
    .join('\n')
  return (
    <>
      <pre className={s.quote}>{body}</pre>
      {hidden > 0 && (
        <p className={s.sub}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            style={toggleStyle}
          >
            {open ? 'show fewer' : `… and ${hidden} more`}
          </button>
        </p>
      )}
    </>
  )
}
