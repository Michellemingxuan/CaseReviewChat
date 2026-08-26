import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchCaseReport } from '../api'
import type { CaseReport } from '../types'
import { PinFigure } from './PinFigure'
import s from './CaseReportPanel.module.css'

/**
 * Every report table gets its own horizontal scroller.
 *
 * `strategy_0.md` is nine columns wide and does not fit the report column
 * at any sane width. Without this the table is simply CLIPPED — the panel
 * clips its overflow, so the right-hand columns (Current/New Global Limit:
 * the figures the whole section exists to show) become unreachable rather
 * than merely cramped. Scrolling the table inside its own box also keeps
 * the page body from scrolling sideways.
 */
function makeComponents(
  picked: Set<string>,
  toggle: (text: string) => void,
  selectable: boolean,
) {
  return {
    table: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div className={s.tableScroll}>
        <table {...props}>{children}</table>
      </div>
    ),
    /**
     * Every list item is a selection target.
     *
     * The report's bullets ARE its claims — one bullet is the unit a reviewer
     * pins or asks about — so selection is offered at that granularity rather
     * than requiring free-text highlighting. A leaf-only rule keeps a parent
     * bullet from silently dragging its children in: `li`s that contain a
     * nested list are rendered plain.
     */
    li: ({ children, ...props }: { children?: React.ReactNode }) => {
      const ref = useRef<HTMLLIElement | null>(null)
      const [text, setText] = useState('')
      useEffect(() => {
        // Read the rendered text rather than reconstructing it from the AST:
        // it is what the reviewer actually sees, emphasis and code spans
        // flattened exactly as displayed.
        const own = ref.current
        if (!own) return
        const clone = own.cloneNode(true) as HTMLElement
        clone.querySelectorAll('ul,ol').forEach((n) => n.remove())
        setText(clone.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      })
      const hasNested = Array.isArray(children)
        && children.some((c) => (c as { type?: string })?.type === 'ul'
          || (c as { type?: string })?.type === 'ol')
      if (!selectable || hasNested) return <li ref={ref} {...props}>{children}</li>
      const on = picked.has(text)
      return (
        <li
          ref={ref}
          {...props}
          className={`${s.pickable} ${on ? s.picked : ''}`}
          onClick={(e) => {
            // Let a click that was really a text selection (or a link) pass.
            if (window.getSelection()?.toString()) return
            if ((e.target as HTMLElement).closest('a')) return
            if (text) toggle(text)
          }}
        >
          <span className={s.tick} aria-hidden="true">{on ? '✓' : ''}</span>
          {children}
        </li>
      )
    },
  }
}

type Props = {
  caseId: string | null
  /** Pin the selected report text as an insight, sourced to this section. */
  onPinInsight?: (text: string, sectionLabel: string) => void
  /** Put a follow-up question about the selection into the assistant. */
  onAsk?: (question: string) => void
  busy?: boolean
}

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; report: CaseReport }
  | { kind: 'error'; message: string }

/**
 * The Case Report panel — a reader for the curated `reports/<case>/*.md`
 * files, which are the same documents the report agent consults.
 *
 * The section chips ARE the report's own file boundaries; order and labels
 * come from the server (`tools/fs_tools.py:REPORT_SECTIONS`), never from a
 * list held here, so the agent and this panel can't disagree about what the
 * report contains.
 *
 * `remark-gfm` is required, not decorative: `strategy_0.md` is a pipe table
 * and renders as literal pipes without it.
 */
export function CaseReportPanel({ caseId, onPinInsight, onAsk, busy }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'idle' })
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // Bullets the reviewer has ticked, keyed by their text. Text is the key
  // because the markdown is re-parsed on every render and list nodes carry
  // no stable id — and duplicate bullets within a section would be
  // indistinguishable to the reviewer anyway.
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!caseId) { setLoad({ kind: 'idle' }); return }
    let cancelled = false
    setLoad({ kind: 'loading' })
    fetchCaseReport(caseId)
      .then((report) => {
        if (cancelled) return
        setLoad({ kind: 'ready', report })
        // Open the first section that actually has content — landing on an
        // empty tab because Exec Summary happens to be missing would read
        // as "the report failed to load".
        const first = report.sections.find((x) => x.markdown) ?? report.sections[0]
        setActiveKey(first?.key ?? null)
      })
      .catch((err) => {
        if (!cancelled) setLoad({ kind: 'error', message: String(err?.message ?? err) })
      })
    return () => { cancelled = true }
  }, [caseId])

  // A selection belongs to the section it was made in; carrying it across a
  // tab switch would let a reviewer pin a Bureau bullet as if it were Modeling.
  useEffect(() => { setPicked(new Set()) }, [activeKey, caseId])

  const active = useMemo(() => {
    if (load.kind !== 'ready') return null
    return load.report.sections.find((x) => x.key === activeKey) ?? null
  }, [load, activeKey])

  const selectable = Boolean(onPinInsight || onAsk)
  const components = useMemo(
    () => makeComponents(picked, (text) => setPicked((cur) => {
      const next = new Set(cur)
      next.has(text) ? next.delete(text) : next.add(text)
      return next
    }), selectable),
    [picked, selectable],
  )

  const chosen = [...picked]
  const label = active?.label ?? 'the report'

  return (
    <section className={s.panel} aria-label="Case report">
      <div className={s.head}>
        <span className={s.headAccent} aria-hidden="true" />
        <span className={`jEyebrow ${s.headTitle}`}>Case Report</span>
        <span className={s.headBadge}>Document</span>
        <span className={s.headMeta}>
          {load.kind === 'ready' && load.report.updated_at
            ? `Updated ${load.report.updated_at}`
            : ''}
        </span>
      </div>

      {load.kind === 'ready' && (
        <div className={s.chips} role="tablist" aria-label="Report sections">
          {load.report.sections.map((sec) => {
            const isActive = sec.key === activeKey
            const missing = !sec.markdown
            return (
              <button
                key={sec.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={sec.filename ?? 'No file for this section in this case'}
                className={[
                  s.chip,
                  isActive ? s.chipActive : '',
                  missing ? s.chipMissing : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveKey(sec.key)}
              >
                {sec.label}
              </button>
            )
          })}
        </div>
      )}

      <div className={s.body}>
        {load.kind === 'idle' && <p className={s.note}>Select a case to read its report.</p>}
        {load.kind === 'loading' && <p className={s.note}>Loading report…</p>}
        {load.kind === 'error' && (
          <p className={`${s.note} ${s.noteError}`}>
            Could not load the report for this case. {load.message}
          </p>
        )}
        {load.kind === 'ready' && !active && <p className={s.note}>This case has no curated report.</p>}
        {active && !active.markdown && (
          <p className={s.note}>
            No <b>{active.label}</b> report exists for this case.
          </p>
        )}
        {active?.markdown && (
          <article className={s.doc}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {active.markdown}
            </ReactMarkdown>
          </article>
        )}

        {/* Figures the reviewer inserted into this section, rendered AFTER
            the prose and visibly separated. They are reviewer annotation,
            not part of the curated report, and the boundary between the two
            is exactly what an auditor needs to see. */}
        {active && active.figures?.length > 0 && (
          <section className={s.inserted} aria-label="Inserted figures">
            <div className={s.insertedHead}>
              Inserted figures
              <span className={s.insertedCount}>{active.figures.length}</span>
            </div>
            {active.figures.map((fig) => (
              <figure key={fig.pin_id} className={s.figure}>
                <PinFigure pin={fig} />
                <figcaption>
                  {fig.text || fig.topic}
                  <span className={s.figureSource}>{fig.source}</span>
                </figcaption>
              </figure>
            ))}
          </section>
        )}
      </div>

      {/* Action bar. Anchored to the panel rather than floating by the
          selection: with several bullets ticked there is no one place a
          floating bar could sit that belongs to all of them. */}
      {chosen.length > 0 && (
        <div className={s.actionBar}>
          <span className={s.actionCount}>
            {chosen.length} selected
          </span>
          <button
            type="button" className={s.pinBtn} disabled={busy}
            onClick={() => {
              chosen.forEach((t) => onPinInsight?.(t, label))
              setPicked(new Set())
            }}
          >
            📌 Pin {chosen.length === 1 ? 'insight' : `${chosen.length} insights`}
          </button>
          <button
            type="button" className={s.askBtn} disabled={busy}
            onClick={() => {
              onAsk?.(buildAskPrompt(chosen, label))
              setPicked(new Set())
            }}
          >
            🔎 More details about {chosen.length === 1 ? 'this' : `these ${chosen.length}`}
          </button>
          <button
            type="button" className={s.clearBtn}
            onClick={() => setPicked(new Set())}
          >
            Clear
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * Turn selected report bullets into a question for the assistant.
 *
 * Quotes them verbatim and names the section, so the specialists can trace
 * the claim back to its source instead of re-deriving it — and so the
 * reviewer can see in the transcript exactly what was asked about.
 */
export function buildAskPrompt(chosen: string[], sectionLabel: string): string {
  if (chosen.length === 1) {
    return `More details about this finding from the ${sectionLabel} report: `
      + `"${chosen[0]}". What does the underlying data show, and what drove it?`
  }
  const quoted = chosen.map((t) => `- "${t}"`).join('\n')
  return `More details about these findings from the ${sectionLabel} report:\n`
    + `${quoted}\n\nFor each, what does the underlying data show, and what drove it?`
}
