import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { fetchCaseList } from '../../api'
import { Sidebar } from '../Sidebar/Sidebar'
import { ChatPanel } from '../ChatPanel/ChatPanel'
import { AuditTracePanel } from '../AuditTracePanel/AuditTracePanel'
import { OrchestrationFlowPanel } from '../OrchestrationFlowPanel/OrchestrationFlowPanel'
import s from './Workspace.module.css'

const LAYOUT_STORAGE_KEY = 'workspace-layout-v1'

type LayoutSizes = {
  '--col-sidebar'?: string
  '--col-chat'?: string
  '--row-trace'?: string
}

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

  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const rightStackRef = useRef<HTMLDivElement | null>(null)
  const sidebarResizerRef = useRef<HTMLDivElement | null>(null)
  const hResizerRef = useRef<HTMLDivElement | null>(null)
  const vResizerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Restore any previously-saved sizes before wiring drag handlers, so the
    // initial paint already reflects the user's last layout.
    const saved = loadLayout()
    if (workspaceRef.current) {
      if (saved['--col-sidebar']) workspaceRef.current.style.setProperty('--col-sidebar', saved['--col-sidebar']!)
      if (saved['--col-chat'])    workspaceRef.current.style.setProperty('--col-chat',    saved['--col-chat']!)
    }
    if (rightStackRef.current && saved['--row-trace']) {
      rightStackRef.current.style.setProperty('--row-trace', saved['--row-trace']!)
    }

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
    // Trace ↔ flow vertical resizer.
    setupResizer({
      handle: vResizerRef.current,
      container: rightStackRef.current,
      axis: 'y',
      varName: '--row-trace',
      minBefore: 200,
      minAfter: 160,
    })
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
        <div className={s.rightSection} style={{ gridRow: 1 }}>
          <AuditTracePanel caseId={activeCase} />
        </div>

        <div ref={vResizerRef} className={`${s.resizer} ${s.resizerV}`} style={{ gridRow: 2 }} title="Drag to resize · double-click to reset" />

        <div className={s.rightSection} style={{ gridRow: 3 }}>
          <OrchestrationFlowPanel caseId={activeCase} />
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
