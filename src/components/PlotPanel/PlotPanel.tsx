import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { ChartInfo, PendingChart, Turn } from '../../types'
import { VegaChart } from './VegaChart'
import s from './PlotPanel.module.css'

const EMPTY_TURNS: Turn[] = []

/** Discriminated tab entry: a fully-rendered chart OR a pending placeholder.
 *  The PlotPanel renders both in the same tab strip so the reviewer sees
 *  "Working on the plot…" the moment a specialist starts charting, not at
 *  end-of-turn when the actual `chart` SSE event lands. */
type Tab =
  | { kind: 'ready'; chart: ChartInfo }
  | { kind: 'pending'; pending: PendingChart }

/**
 * Plots panel — third row of the right stack, sibling of AuditTracePanel
 * and OrchestrationFlowPanel. Shows every chart emitted on the active
 * turn as tabs along the top; the selected tab renders the chart image
 * at full panel width with its claim and source caption.
 *
 * "Working on the plots" placeholders: when a specialist calls
 * `make_chart`, the server emits `chart_pending` immediately (after
 * validation, before matplotlib runs). The frontend renders a placeholder
 * tab keyed by (specialist, topic). The placeholder is replaced when the
 * matching `chart` event arrives — typically at end-of-turn after the
 * distiller drains.
 *
 * Mirrors the Orchestration Flow's selection model: it follows the user's
 * `activeTurnId` rather than auto-jumping to the streaming turn — that way
 * a reviewer who clicks back to an older turn can inspect both its agent
 * graph AND its plots side-by-side.
 */
export function PlotPanel({ caseId }: { caseId: string | null }) {
  const turns = useStore((st) => (caseId ? st.turns[caseId] : undefined)) ?? EMPTY_TURNS
  const activeTurnId = useStore((st) => (caseId ? st.activeTurnId[caseId] : null))
  const turn = turns.find((t) => t.turn_id === activeTurnId) ?? turns[turns.length - 1] ?? null

  const charts: ChartInfo[] = turn?.charts ?? []
  const pendingCharts: PendingChart[] = turn?.pendingCharts ?? []
  // Merged tab list: completed charts first (stable order from the chart
  // SSE event sequence), then pending placeholders. Once a pending entry's
  // (specialist, topic) matches an arrived chart, the store has already
  // cleared the pending entry — no duplicate tab.
  const tabs: Tab[] = [
    ...charts.map<Tab>((c) => ({ kind: 'ready', chart: c })),
    ...pendingCharts.map<Tab>((p) => ({ kind: 'pending', pending: p })),
  ]
  const [activeIdx, setActiveIdx] = useState(0)

  // When the active turn changes (or charts appear on a streaming turn),
  // snap the selected tab back to index 0 so the user lands on the first
  // chart of the new turn instead of an out-of-range index from before.
  useEffect(() => {
    setActiveIdx(0)
  }, [turn?.turn_id])

  // Clamp the selected index when tabs shrink (rare — only on rewind).
  const safeIdx = tabs.length === 0 ? 0 : Math.min(activeIdx, tabs.length - 1)
  const active = tabs[safeIdx]
  const readyCount = charts.length
  const pendingCount = pendingCharts.length

  return (
    <div className={s.panel}>
      {/* Counter only — the panel name comes from the tab strip above;
          repeating "Plots" as an internal header is redundant. The
          counter only renders when there are actually plots to count. */}
      {tabs.length > 0 && (
        <div className={s.head}>
          <span className={s.count}>
            {readyCount} ready
            {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
          </span>
        </div>
      )}

      {tabs.length === 0 ? (
        <div className={s.empty}>
          <strong>No plots in this turn</strong>
          Charts produced by the specialists or the chart agent will appear here.
        </div>
      ) : (
        <div className={s.body}>
          {/* Tabs as a vertical column on the LEFT — reviewers scan a list
              top-to-bottom and the active chart fills the rest of the
              panel to the right. */}
          <div className={s.tabs} role="tablist" aria-orientation="vertical">
            {tabs.map((t, i) => {
              const key = t.kind === 'ready'
                ? `ready/${t.chart.specialist}/${t.chart.topic}`
                : `pending/${t.pending.specialist}/${t.pending.topic}`
              const specialist = t.kind === 'ready' ? t.chart.specialist : t.pending.specialist
              const topic = t.kind === 'ready' ? t.chart.topic : t.pending.topic
              const kindStr = t.kind === 'ready' ? t.chart.kind : t.pending.kind
              const title = t.kind === 'ready'
                ? (t.chart.claim || topic)
                : `Working on the plot — ${topic}`
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIdx}
                  className={`${s.tab} ${i === safeIdx ? s.tabActive : ''} ${t.kind === 'pending' ? s.tabPending : ''}`}
                  onClick={() => setActiveIdx(i)}
                  title={title}
                >
                  <span className={s.tabIcon}>
                    {t.kind === 'pending' ? '⏳' : kindIcon(kindStr)}
                  </span>
                  <span className={s.tabLabel}>
                    <span className={s.tabTopic}>{topic.replace(/_/g, ' ')}</span>
                    <span className={s.tabSpecialist}>{specialist}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {active && active.kind === 'ready' && (
            <div className={s.viewer} role="tabpanel">
              {active.chart.claim ? <p className={s.claim}>{active.chart.claim}</p> : null}
              <div className={s.imageWrap}>
                {/* Render path depends on chart kind:
                    - `table` → HTML <table> from numbers/x_field/y_fields.
                    - any kind WITH a vega_spec → interactive SVG via
                      VegaChart (re-paints on every panel resize).
                    - else → static PNG fallback. */}
                {active.chart.kind === 'table' ? (
                  <DataTable chart={active.chart} />
                ) : active.chart.vega_spec ? (
                  <VegaChart
                    spec={active.chart.vega_spec as Record<string, unknown>}
                    alt={active.chart.topic}
                  />
                ) : (
                  <img
                    className={s.image}
                    src={active.chart.url}
                    alt={active.chart.topic}
                  />
                )}
              </div>
              <div className={s.meta}>
                <span className={s.metaKey}>{active.chart.specialist}</span>
                {active.chart.source_call ? (
                  <>
                    <span className={s.metaSep}>·</span>
                    <span className={s.metaKey}>via:</span>
                    <code className={s.metaCode}>{active.chart.source_call}</code>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {active && active.kind === 'pending' && (
            <div className={s.viewer} role="tabpanel">
              <div className={s.pendingWrap}>
                <div className={s.spinner} aria-hidden="true" />
                <p className={s.pendingTitle}>Working on the plot…</p>
                <p className={s.pendingSub}>
                  <code>{active.pending.specialist}</code> is rendering{' '}
                  <strong>{active.pending.topic.replace(/_/g, ' ')}</strong>
                  {active.pending.kind ? <> ({active.pending.kind})</> : null}.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function kindIcon(kind: string): string {
  if (kind === 'trend' || kind === 'trend_dual' || kind === 'trend_grid') return '📈'
  if (kind === 'share') return '📊'
  if (kind === 'bar') return '📉'
  if (kind === 'table') return '📋'
  return '🔎'
}

/** Render a `kind === "table"` chart event as a real HTML table. The
 *  server emits these for 1-3 row datasets where a plot's shape would
 *  be noise — the rows are surfaced as a table card so the reviewer
 *  reads the exact figures directly. Column order: x_field first, then
 *  every y_field in the order the specialist listed them. */
function DataTable({ chart }: { chart: ChartInfo }) {
  const rows = chart.numbers ?? []
  const xField = chart.x_field ?? ''
  const yFields = chart.y_fields ?? []
  // If the server didn't supply explicit x/y fields (legacy KP),
  // derive a column list from the first row's keys.
  const columns: string[] = xField || yFields.length > 0
    ? [xField, ...yFields].filter(Boolean)
    : Object.keys(rows[0] ?? {})

  if (rows.length === 0 || columns.length === 0) {
    return (
      <div className={s.tableEmpty}>No rows in this table.</div>
    )
  }

  return (
    <div className={s.tableScroll}>
      <table className={s.dataTable}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c.replace(/_/g, ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{formatCell(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
    if (abs >= 1_000) return (v / 1_000).toFixed(2) + 'K'
    if (Number.isInteger(v)) return String(v)
    return v.toFixed(2)
  }
  return String(v)
}
