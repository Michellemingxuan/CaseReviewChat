import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCaseReport, fetchOpportunities, postOpportunity, postSynthesis } from '../../api'
import type { Opportunity, PinSynthesis, ReportSection, SynthesisMode } from '../../types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { usePins } from '../usePins'
import { PinFigure } from '../PinFigure'
import { PinProvenance } from '../PinProvenance'
import { ChartTypeIcon } from '../ChartTypeIcon'
import s from './OpportunitiesView.module.css'

/**
 * Pinned figures and insights, and the opportunities they become.
 *
 * The design also shows an "AI SYNTHESIS — 3 SELECTED PINS" block that
 * reconstructs a story or proposes opportunities from the selection. That
 * needs an agent call the backend does not expose yet, so this screen ships
 * the parts that are real — pin review, insertion into report sections, and
 * manual opportunity capture — and says plainly where the synthesis will go
 * rather than faking a generated paragraph.
 */
export function OpportunitiesView({ caseId }: { caseId: string | null }) {
  const { pins, unpin, setSection, clearRetracted, busy, reload } = usePins(caseId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [sections, setSections] = useState<ReportSection[]>([])
  const [title, setTitle] = useState('')
  // Which figure the enlarged panel is showing. Defaults to the first, so
  // that quadrant is never an empty box next to a full grid.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [synth, setSynth] = useState<PinSynthesis | null>(null)
  const [synthMode, setSynthMode] = useState<SynthesisMode | null>(null)
  const [synthError, setSynthError] = useState<string | null>(null)

  const figures = useMemo(() => pins.filter((p) => p.kind === 'figure'), [pins])
  const insights = useMemo(() => pins.filter((p) => p.kind === 'insight'), [pins])
  const focused = useMemo(
    () => figures.find((f) => f.pin_id === focusedId) ?? figures[0] ?? null,
    [figures, focusedId],
  )

  const loadOpps = useCallback(async () => {
    if (!caseId) { setOpps([]); return }
    try { setOpps(await fetchOpportunities(caseId)) }
    catch (e) { console.error('Failed to load opportunities', e) }
  }, [caseId])

  useEffect(() => { void loadOpps() }, [loadOpps])

  // Section list drives the "Insert into …" menu. Read from the report rather
  // than hard-coded so it stays in step with the server's own roster.
  useEffect(() => {
    if (!caseId) { setSections([]); return }
    let cancelled = false
    fetchCaseReport(caseId)
      .then((r) => { if (!cancelled) setSections(r.sections.filter((x) => x.markdown)) })
      .catch((e) => console.error('Failed to load report sections', e))
    return () => { cancelled = true }
  }, [caseId])

  const toggle = (pinId: string) => setSelected((cur) => {
    const next = new Set(cur)
    next.has(pinId) ? next.delete(pinId) : next.add(pinId)
    return next
  })

  const runSynthesis = async (mode: SynthesisMode) => {
    if (!caseId || selected.size === 0) return
    setSynthMode(mode)
    setSynth(null)
    setSynthError(null)
    try {
      setSynth(await postSynthesis(caseId, mode, [...selected]))
    } catch (e) {
      setSynthError(String((e as Error)?.message ?? e))
    } finally {
      setSynthMode(null)
    }
  }

  /** Promote one proposed opportunity to a real one, keeping the link back
   *  to the pins it came from. */
  const acceptProposal = async (title: string, body: string) => {
    if (!caseId) return
    await postOpportunity(caseId, { title, body, pin_ids: synth?.pin_ids ?? [...selected] })
    await loadOpps()
  }

  const create = async () => {
    if (!caseId || !title.trim()) return
    await postOpportunity(caseId, { title: title.trim(), pin_ids: [...selected] })
    setTitle('')
    setSelected(new Set())
    await loadOpps()
  }

  if (!caseId) {
    return <div className={s.empty}><p>Select a case to see its pins.</p></div>
  }

  const retracted = pins.filter((p) => p.retracted)

  return (
    <div className={s.wrap}>
      {/* Retraction keeps a rewound pin rather than deleting it — pinning is
          deliberate and rewind is one click. Letting it go stays the
          reviewer's choice, so it gets one obvious action instead of
          happening silently. */}
      {retracted.length > 0 && (
        <div className={s.retractedBar}>
          <span>
            <b>{retracted.length}</b> pin{retracted.length === 1 ? '' : 's'} from
            rewound turns. Kept so nothing you filed disappears on its own —
            they are excluded from report sections.
          </span>
          <button type="button" className={s.retractedClear}
                  disabled={busy} onClick={clearRetracted}>
            Remove {retracted.length === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}
      {/* Left column: what was said. Right column: what was drawn.
          Reading order runs claims -> synthesis on the left, and the figure
          grid -> the figure you are actually looking at on the right, so
          picking a thumbnail never moves your eye across the page. */}
      <div className={s.colLeft}>
        <Panel title="Pinned Insights" count={insights.length}>
          {insights.length === 0 && (
            <p className={s.none}>
              None yet. Highlight a sentence in an answer and use <b>Pin selection</b>,
              or tick bullets in the report and use <b>Pin insight</b>.
            </p>
          )}
          {insights.map((p) => (
            <div key={p.pin_id}
                 className={`${s.insight} ${p.retracted ? s.pinRetracted : ''}`}>
              <label className={s.check}>
                <input type="checkbox" checked={selected.has(p.pin_id)}
                       onChange={() => toggle(p.pin_id)} />
              </label>
              <div className={s.insightBody}>
                <div className={s.insightText}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
                </div>
                <div className={s.insightMeta}>
                  {p.turn_index != null && <span className={s.turnChip}>Turn {p.turn_index}</span>}
                  {p.source && p.source !== `Turn ${p.turn_index}` && <span>{p.source}</span>}
                  <button type="button" className={s.link}
                          disabled={busy} onClick={() => unpin(p.pin_id)}>
                    Unpin
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Synthesis lives INSIDE this panel rather than in a card of its
              own: it acts on the selection made in the list directly above,
              and a separate box made that relationship invisible. The count
              says "pins" because figures on the right are selectable too. */}
          <div className={s.synthBlock}>
            <div className={s.synthHead}>
              <span className={s.synthTitle}>Synthesise across selected pins</span>
              <span className={s.synthCount}>
                {selected.size} pin{selected.size === 1 ? '' : 's'} selected
              </span>
            </div>

          <div className={s.modes}>
            <button
              type="button"
              className={s.modeBtn}
              disabled={selected.size === 0 || synthMode !== null}
              onClick={() => runSynthesis('story')}
            >
              {synthMode === 'story' ? 'Reading the pins…' : 'Reconstruct the story'}
            </button>
            <button
              type="button"
              className={s.modeBtn}
              disabled={selected.size === 0 || synthMode !== null}
              onClick={() => runSynthesis('opportunities')}
            >
              {synthMode === 'opportunities' ? 'Thinking…' : 'Propose opportunities'}
            </button>
          </div>
          {selected.size === 0 && (
            <p className={s.hint}>Select pins above to synthesise across them.</p>
          )}
          {synthMode !== null && (
            <p className={s.hint}>
              Reading {selected.size} pin{selected.size === 1 ? '' : 's'} together — this is a
              real model call and takes a few seconds.
            </p>
          )}
          {synthError && <p className={s.synthError}>{synthError}</p>}

          {synth && (
            <div className={s.synth}>
              {synth.story && (
                <div className={s.story}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{synth.story}</ReactMarkdown>
                </div>
              )}

              {synth.opportunities.length > 0 && (
                <ul className={s.proposals}>
                  {synth.opportunities.map((o) => (
                    <li key={o.title} className={s.proposal}>
                      <div className={s.proposalBody}>
                        <b>{o.title}</b>
                        {o.rationale && <span>{o.rationale}</span>}
                      </div>
                      <button
                        type="button" className={s.accept}
                        onClick={() => acceptProposal(o.title, o.rationale)}
                      >
                        + Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Always rendered when present: the reviewer defends this
                  downstream, and the caveats are the half that protects them. */}
              {synth.not_settled.length > 0 && (
                <div className={s.notSettled}>
                  <div className={s.notSettledHead}>Not settled by these pins</div>
                  <ul>
                    {synth.not_settled.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          </div>
        </Panel>

        <Panel title="Opportunities" count={opps.length}>
          {/* Manual capture, deliberately here and not under the synthesis
              buttons. It is not an AI action — it writes exactly what you
              type — and sitting among them it read as a prompt box. */}
          <div className={s.createRow}>
            <input
              className={s.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Write an opportunity…"
            />
            <button type="button" className={s.primary}
                    disabled={!title.trim()} onClick={create}>
              Add
            </button>
          </div>
          {selected.size > 0 && (
            <p className={s.selNote}>
              Will be linked to the {selected.size} selected pin
              {selected.size === 1 ? '' : 's'}.
            </p>
          )}

          {opps.length === 0 && <p className={s.none}>No opportunities captured yet.</p>}
          {opps.map((o) => (
            <div key={o.opp_id} className={s.opp}>
              <b className={s.oppTitle}>{o.title}</b>
              {o.body && <p className={s.oppBody}>{o.body}</p>}
              {o.pin_ids.length > 0 && (
                <span className={s.fromPins}>from {o.pin_ids.length} pin
                  {o.pin_ids.length === 1 ? '' : 's'}</span>
              )}
            </div>
          ))}
        </Panel>
      </div>

      <div className={s.colRight}>
        <Panel title="Pinned Figures" count={figures.length}>
          {figures.length === 0 && (
            <p className={s.none}>
              None yet. Use <b>Pin</b> on a figure in the assistant.
            </p>
          )}
          <div className={s.figGrid}>
            {figures.map((p) => (
              <div
                key={p.pin_id}
                className={[
                  s.figCard,
                  focused?.pin_id === p.pin_id ? s.figCardActive : '',
                  p.retracted ? s.pinRetracted : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setFocusedId(p.pin_id)}
              >
                <label className={s.check} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(p.pin_id)}
                         onChange={() => toggle(p.pin_id)} />
                </label>
                <ChartTypeIcon kind={p.chart_kind} className={s.thumb} />
                <div className={s.figMeta}>
                  <b>{p.topic}</b>
                  <PinProvenance pin={p} />
                </div>
                <div className={s.figActions} onClick={(e) => e.stopPropagation()}>
                  <select
                    className={s.select}
                    value={p.section_key ?? ''}
                    disabled={busy}
                    onChange={(e) => setSection(p.pin_id, e.target.value || null)}
                  >
                    <option value="">Insert into…</option>
                    {sections.map((sec) => (
                      <option key={sec.key} value={sec.key}>{sec.label}</option>
                    ))}
                  </select>
                  <button type="button" className={s.link}
                          disabled={busy} onClick={() => unpin(p.pin_id)}>
                    Unpin
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* The enlarged view. A thumbnail grid is for FINDING a figure; a
            reviewer deciding whether it belongs in the report has to read
            its axes, and this is where that happens. */}
        <Panel title="Enlarged Figure" count={0} countLabel="">
          {!focused && <p className={s.none}>Pin a figure to inspect it here.</p>}
          {focused && (
            <figure className={s.enlarged}>
              <PinFigure pin={focused} className={s.enlargedImg} />
              <figcaption className={s.enlargedCaption}>
                <b>{focused.topic}</b>
                {focused.text && <span>{focused.text}</span>}
                <span className={s.enlargedSource}>{focused.source}</span>
              </figcaption>
            </figure>
          )}
        </Panel>
      </div>

      <button type="button" className={s.refresh} onClick={() => { void reload(); void loadOpps() }}>
        Refresh
      </button>
    </div>
  )
}

function Panel({ title, count, countLabel, children }: {
  title: string
  count: number
  countLabel?: string
  children: React.ReactNode
}) {
  const showCount = count > 0 || countLabel === undefined
  return (
    <section className={s.panel}>
      <div className={s.head}>
        <span className={`jEyebrow ${s.headTitle}`}>{title}</span>
        {showCount && (
          <span className={s.count}>{count}{countLabel ? ` ${countLabel}` : ''}</span>
        )}
      </div>
      <div className={s.body}>{children}</div>
    </section>
  )
}
