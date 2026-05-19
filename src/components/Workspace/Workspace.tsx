import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { fetchCaseList } from '../../api'
import { Sidebar } from '../Sidebar/Sidebar'
import { ChatPanel } from '../ChatPanel/ChatPanel'
import { AuditTracePanel } from '../AuditTracePanel/AuditTracePanel'
import { OrchestrationFlowPanel } from '../OrchestrationFlowPanel/OrchestrationFlowPanel'
import { PlotPanel } from '../PlotPanel/PlotPanel'
import s from './Workspace.module.css'

// Bumped v2 → v3 when the right-stack layout changed again: upper is now
// the reasoning trace ALONE (full width), lower is a tabbed area that
// toggles between OrchestrationFlow and PlotPanel. The previous
// `--col-trace` saved value would silently break the new layout.
const LAYOUT_STORAGE_KEY = 'workspace-layout-v3'

type LayoutSizes = {
  '--col-sidebar'?: string
  '--col-chat'?: string
  /** Height split between upper (trace) and lower (tabbed flow/plots). */
  '--row-upper'?: string
}

/** Which tab is active in the lower (tabbed) section. */
type LowerTab = 'flow' | 'plots'

function loadLayout(): LayoutSizes {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LayoutSizes) : {}
  } catch {
    return {}
  }
}

function saveLayout(patch: LayoutSizes) {
  const current = loadLayout()
  const next = { ...current, ...patch }
  // Drop empty/undefined keys so a reset truly resets.
  ;(Object.keys(next) as (keyof LayoutSizes)[]).forEach((k) => {
    if (!next[k]) delete next[k]
  })
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next))
}

/**
 * Clamp persisted layout values against the current viewport. The
 * stored values are raw pixel strings (e.g. "400px") captured from
 * whichever screen the user last sized things on. Moving the window
 * between screens with different dimensions (high-DPI external monitor
 * → laptop screen) can leave those pixel values WAY out of range for
 * the new viewport — e.g. a 400px sidebar on a 2560-wide monitor is
 * sensible, but on a 1280-wide laptop screen it eats a third of the
 * width. Hard-refresh after the move would reapply the stale values
 * and leave the layout obviously broken. This helper detects the
 * stale-too-big case and replaces those values with `undefined` so
 * the CSS default (`1fr` / fr-grid math) takes over and adapts to the
 * new viewport.
 *
 * Range rules:
 *   - `--col-sidebar`: 160px – 25% of viewport width.
 *   - `--col-chat`: 480px – 70% of viewport width (only clamped if
 *     stored as px, not as fr).
 *   - `--row-upper`: 220px – 75% of right-stack vertical room
 *     (approx. window inner height; the right-stack inherits this
 *     after subtracting toolbars / chrome). Only clamped when stored
 *     as px.
 *
 * Returns a NEW object; callers can pass the result to
 * `setProperty` directly. Keys whose stored value is now out of range
 * are OMITTED so the CSS fallback applies.
 */
export function clampLayoutToViewport(
  saved: LayoutSizes,
  viewport?: { vw: number; vh: number },
): LayoutSizes {
  const vw = viewport?.vw
    ?? (typeof window !== 'undefined' ? window.innerWidth : 1920)
  const vh = viewport?.vh
    ?? (typeof window !== 'undefined' ? window.innerHeight : 1080)
  const out: LayoutSizes = { ...saved }

  const parsePx = (v: string | undefined): number | null => {
    if (!v) return null
    const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*px$/)
    return m ? parseFloat(m[1]) : null
  }

  const sidebar = parsePx(saved['--col-sidebar'])
  if (sidebar != null && (sidebar < 160 || sidebar > vw * 0.25)) {
    delete out['--col-sidebar']
  }

  const chat = parsePx(saved['--col-chat'])
  if (chat != null && (chat < 480 || chat > vw * 0.7)) {
    delete out['--col-chat']
  }

  const rowUpper = parsePx(saved['--row-upper'])
  if (rowUpper != null && (rowUpper < 220 || rowUpper > vh * 0.75)) {
    delete out['--row-upper']
  }

  return out
}

/**
 * Top-level layout: sidebar | chat | right-stack (audit trace + flow).
 *
 * Three resizers (sidebar↔chat, chat↔right, trace↔flow). User-dragged sizes
 * persist to localStorage so a refresh keeps the same layout. Double-clicking
 * a handle resets just that divider; sizes for the other panels are kept.
 */
export function Workspace() {
  const caseList = useStore((st) => st.caseList)
  const activeCase = useStore((st) => st.activeCase)
  const unread = useStore((st) => st.unread)
  const setCaseList = useStore((st) => st.setCaseList)
  const setActiveCase = useStore((st) => st.setActiveCase)

  useEffect(() => {
    fetchCaseList().then(setCaseList).catch(console.error)
  }, [setCaseList])

  const [lowerTab, setLowerTab] = useState<LowerTab>('flow')
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const rightStackRef = useRef<HTMLDivElement | null>(null)
  const sidebarResizerRef = useRef<HTMLDivElement | null>(null)
  const hResizerRef = useRef<HTMLDivElement | null>(null)
  const vResizerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    /** Apply persisted layout values, clamped to the current viewport.
     * Values out of range for the current screen (e.g. moved from a
     * 2560-wide monitor to a 1280-wide laptop) are SKIPPED so the CSS
     * `1fr` fallback adapts to the new viewport. We re-run this on
     * window-resize so moving the window across screens at runtime
     * also gracefully re-fits. */
    const applyLayout = () => {
      const saved = clampLayoutToViewport(loadLayout())
      const ws = workspaceRef.current
      const rs = rightStackRef.current
      if (ws) {
        // For each var: apply the clamped value if present, otherwise
        // clear any prior inline style so the CSS default takes over.
        if (saved['--col-sidebar']) {
          ws.style.setProperty('--col-sidebar', saved['--col-sidebar'])
        } else {
          ws.style.removeProperty('--col-sidebar')
        }
        if (saved['--col-chat']) {
          ws.style.setProperty('--col-chat', saved['--col-chat'])
        } else {
          ws.style.removeProperty('--col-chat')
        }
      }
      if (rs) {
        if (saved['--row-upper']) {
          rs.style.setProperty('--row-upper', saved['--row-upper'])
        } else {
          rs.style.removeProperty('--row-upper')
        }
      }
    }

    // Initial apply — runs once on mount AND after every hard-refresh.
    applyLayout()

    // Re-apply on window resize so moving across screens at runtime
    // re-clamps the layout. Debounced so a slow drag-resize doesn't
    // thrash. 200ms feels responsive without being wasteful.
    let resizeTimer = 0 as ReturnType<typeof setTimeout> | 0
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = 0
        applyLayout()
      }, 200)
    }
    window.addEventListener('resize', onResize)

    // Sidebar resizer — must reserve room for chat + right column + their gaps.
    setupResizer({
      handle: sidebarResizerRef.current,
      container: workspaceRef.current,
      axis: 'x',
      varName: '--col-sidebar',
      minBefore: 160,
      minAfter: 480 + 4 + 420 + 4,
    })
    // Chat ↔ right-stack resizer — must reserve room for right column.
    setupResizer({
      handle: hResizerRef.current,
      container: workspaceRef.current,
      axis: 'x',
      varName: '--col-chat',
      minBefore: 480,
      minAfter: 420,
    })
    // Upper (trace) ↔ lower (tabbed flow/plots) vertical resizer.
    setupResizer({
      handle: vResizerRef.current,
      container: rightStackRef.current,
      axis: 'y',
      varName: '--row-upper',
      minBefore: 220,
      minAfter: 220,
    })

    return () => {
      window.removeEventListener('resize', onResize)
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [])

  return (
    <div ref={workspaceRef} className={s.workspace}>
      <Sidebar
        consumerCases={caseList?.consumer ?? []}
        commercialCases={caseList?.commercial ?? []}
        activeCase={activeCase}
        unread={unread}
        onSelect={setActiveCase}
      />

      <div ref={sidebarResizerRef} className={`${s.resizer} ${s.resizerH}`} title="Drag to resize · double-click to reset" />

      <div className={s.col}>
        <ChatPanel />
      </div>

      <div ref={hResizerRef} className={`${s.resizer} ${s.resizerH}`} title="Drag to resize · double-click to reset" />

      <div ref={rightStackRef} className={s.rightStack}>
        {/* Upper — reasoning trace (full width). */}
        <div className={s.rightSection} style={{ gridRow: 1 }}>
          <AuditTracePanel caseId={activeCase} />
        </div>

        <div ref={vResizerRef} className={`${s.resizer} ${s.resizerV}`} style={{ gridRow: 2 }} title="Drag to resize · double-click to reset" />

        {/* Lower — tabbed container that toggles between the
            orchestration flow and the plots. The tab strip lives at the
            top; the active tab's panel fills the rest. Both panels
            mount eagerly (display:none on the inactive one) so the
            chart's vega view + the flow's auto-scale observers don't
            churn through mount/unmount cycles when the user flips
            between tabs. */}
        <div className={`${s.rightSection} ${s.lowerTabbed}`} style={{ gridRow: 3 }}>
          <div className={s.tabStrip} role="tablist" aria-label="Lower-pane content">
            <button
              type="button"
              role="tab"
              aria-selected={lowerTab === 'flow'}
              className={`${s.tab} ${lowerTab === 'flow' ? s.tabActive : ''}`}
              onClick={() => setLowerTab('flow')}
            >
              Orchestration Flow
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lowerTab === 'plots'}
              className={`${s.tab} ${lowerTab === 'plots' ? s.tabActive : ''}`}
              onClick={() => setLowerTab('plots')}
            >
              Plots
            </button>
          </div>
          {/* Conditionally mount the ACTIVE tab's panel. We previously
              eager-mounted both with `display: none` on the inactive
              one, but `display: none` makes the hidden panel a 0×0
              container — and vega-embed (inside PlotPanel's VegaChart)
              initializes against that 0×0 box on first mount, then
              stays degraded even after the tab becomes visible.
              ResizeObserver fires on the eventual show, but
              vega-embed's view never recovers from the initial
              zero-size render. Mounting only the active tab means each
              panel sees real pixel dimensions at mount time, so the
              first plot renders correctly the moment the user opens
              the Plots tab. State preservation cost is minimal: the
              chart payloads live in the store; the Vega view is
              re-created on each tab switch (sub-second). */}
          {lowerTab === 'flow' && (
            <div className={s.tabPane}>
              <OrchestrationFlowPanel caseId={activeCase} />
            </div>
          )}
          {lowerTab === 'plots' && (
            <div className={s.tabPane}>
              <PlotPanel caseId={activeCase} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Resizer plumbing ──────────────────────────────────────────────────────

function setupResizer({
  handle, container, axis, varName, minBefore, minAfter,
}: {
  handle: HTMLElement | null
  container: HTMLElement | null
  axis: 'x' | 'y'
  varName: string
  minBefore: number
  minAfter: number
}) {
  if (!handle || !container) return
  let startPos = 0, startSize = 0, containerSize = 0

  const onMove = (e: MouseEvent) => {
    const pos = axis === 'x' ? e.clientX : e.clientY
    const delta = pos - startPos
    const maxSize = containerSize - minAfter - 4
    let next = startSize + delta
    next = Math.max(minBefore, Math.min(maxSize, next))
    container.style.setProperty(varName, `${next}px`)
  }
  const onUp = () => {
    handle.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    // Persist the final value so refresh keeps the user's adjustment.
    const finalValue = container.style.getPropertyValue(varName)
    if (finalValue) saveLayout({ [varName]: finalValue } as LayoutSizes)
  }

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    handle.classList.add('dragging')
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    const cRect = container.getBoundingClientRect()
    containerSize = axis === 'x' ? cRect.width : cRect.height
    const before = handle.previousElementSibling as HTMLElement | null
    if (before) {
      const bRect = before.getBoundingClientRect()
      startSize = axis === 'x' ? bRect.width : bRect.height
    }
    startPos = axis === 'x' ? e.clientX : e.clientY
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  handle.addEventListener('dblclick', () => {
    container.style.removeProperty(varName)
    saveLayout({ [varName]: undefined } as LayoutSizes)
  })
}
