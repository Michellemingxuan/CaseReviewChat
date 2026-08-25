import { useEffect, useRef, useState } from 'react'
import { AssistantPanel } from './chat/AssistantPanel'
import { AuditTracePanel } from '../components/AuditTracePanel/AuditTracePanel'
import { CaseReportPanel } from './CaseReportPanel'
import { usePins } from './usePins'
import {
  applyLayout, clampLayout, clampLayoutTogether, loadLayout, setupResizer,
} from '../lib/resizer'
import type { ClampRule } from '../lib/resizer'
import s from './CaseWorkspace.module.css'

const LAYOUT_KEY = 'journey-layout-v1'
/** Remembered across sessions: a reviewer who works with the trace closed
 *  should not have to close it again on every reload. */
const TRACE_COLLAPSED_KEY = 'journey-trace-collapsed'

/** Bounds for the two draggable columns. The trace column takes the
 *  remainder, so it needs no stored width — only a floor, enforced as the
 *  `minAfter` of the chat resizer. */
/** Floor for the trace column, which takes the remainder and stores no
 *  width of its own. Must match the `minmax()` floor in the stylesheet. */
const TRACE_MIN = 320

const RULES: Record<string, ClampRule> = {
  '--j-col-report': { min: 280, maxVw: 0.45 },
  '--j-col-chat': { min: 420, maxVw: 0.6 },
}

type Props = {
  caseId: string | null
  /** Question handed from the report panel to the assistant. */
  ask: { text: string; key: number } | null
  onAsk: (question: string) => void
}

/**
 * The split case workspace: report | assistant | reasoning trace.
 *
 * Columns are driven by which panes the rail has lit. Both companion panes
 * on gives the design's three-column screen; either one alone widens to fill
 * the space. The trace rides with the assistant — it is that panel's
 * explanation of itself, and showing it beside the report alone would leave
 * it explaining a conversation that is not on screen.
 *
 * Panels are mounted only when their pane is on. That is deliberate rather
 * than `display:none`: vega-embed (inside each turn's Plots tab) initialises
 * against a 0x0 box when hidden that way and never recovers (see the note in
 * `components/Workspace/Workspace.tsx`), and the trace panel runs
 * auto-scale observers with the same hazard.
 */
export function CaseWorkspace({ caseId, ask, onAsk }: Props) {
  const { pinReportText, busy: pinBusy } = usePins(caseId)
  const [traceOpen, setTraceOpen] = useState(() => {
    try { return localStorage.getItem(TRACE_COLLAPSED_KEY) !== '1' }
    catch { return true }
  })
  const gridRef = useRef<HTMLDivElement | null>(null)
  const reportResizerRef = useRef<HTMLDivElement | null>(null)
  const chatResizerRef = useRef<HTMLDivElement | null>(null)


  useEffect(() => {
    try { localStorage.setItem(TRACE_COLLAPSED_KEY, traceOpen ? '0' : '1') }
    catch { /* a lost preference is cosmetic */ }
  }, [traceOpen])

  useEffect(() => {
    const apply = () => {
      // Two passes: each column against its own bounds, then all of them
      // against the viewport TOGETHER. The second pass is what stops a pair
      // of individually-legal widths from squeezing the trace column off
      // screen when the window moves to a smaller display.
      const vars = Object.keys(RULES)
      const perVar = clampLayout(loadLayout(LAYOUT_KEY), RULES)
      // Reserve: both gutters plus the trace column's floor.
      const together = clampLayoutTogether(perVar, vars, 8 + TRACE_MIN)
      applyLayout(gridRef.current, together, vars)
    }
    apply()

    // Re-clamp on resize so dragging the window across screens of different
    // widths re-fits rather than keeping a stale pixel width. Debounced —
    // a slow drag-resize would otherwise thrash localStorage reads.
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 200)
    }
    window.addEventListener('resize', onResize)

    const teardowns = [
      setupResizer({
        handle: reportResizerRef.current,
        container: gridRef.current,
        axis: 'x',
        varName: '--j-col-report',
        minBefore: RULES['--j-col-report'].min,
        // Reserve the chat floor plus the trace floor plus both gutters.
        minAfter: RULES['--j-col-chat'].min + TRACE_MIN + 8,
        storageKey: LAYOUT_KEY,
      }),
      setupResizer({
        handle: chatResizerRef.current,
        container: gridRef.current,
        axis: 'x',
        varName: '--j-col-chat',
        minBefore: RULES['--j-col-chat'].min,
        minAfter: TRACE_MIN,
        storageKey: LAYOUT_KEY,
      }),
    ]

    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
      teardowns.forEach((t) => t())
    }
  }, [traceOpen])

  return (
    <div ref={gridRef} className={`${s.grid} ${s.split} ${traceOpen ? '' : s.traceHidden}`}>
      <div className={s.cell}>
          <CaseReportPanel
            caseId={caseId}
            onPinInsight={pinReportText}
            onAsk={onAsk}
            busy={pinBusy}
          />
      </div>

      <div ref={reportResizerRef} className={s.resizer}
           title="Drag to resize · double-click to reset" />

      <div className={`${s.cell} ${s.chatCell}`}>
        <AssistantPanel caseId={caseId} ask={ask} />
      </div>

      {traceOpen && (
        <div ref={chatResizerRef} className={s.resizer}
             title="Drag to resize · double-click to reset" />
      )}

      {traceOpen ? (
        <div className={`${s.cell} ${s.traceCell}`}>
          {/* The fold control is rendered BY the panel, inside its flex
              header. Overlaying it here put it on top of the "next turn"
              arrow and swallowed those clicks. */}
          <AuditTracePanel caseId={caseId} onCollapse={() => setTraceOpen(false)} />
        </div>
      ) : (
        /* Collapsed to a spine rather than removed outright: a reviewer needs
           to see that the trace exists and is one click away, and a panel that
           vanishes with no trace of itself is indistinguishable from one that
           broke. */
        <button
          type="button"
          className={s.traceSpine}
          onClick={() => setTraceOpen(true)}
          title="Show the reasoning trace"
          aria-expanded="false"
        >
          <span className={s.spineChevron} aria-hidden="true">⟨⟨</span>
          <span className={s.spineLabel}>Reasoning Trace</span>
        </button>
      )}
    </div>
  )
}
