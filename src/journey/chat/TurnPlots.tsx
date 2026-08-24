import { useState } from 'react'
import { VegaChart } from '../../components/PlotPanel/VegaChart'
import { FigureLightbox, type LightboxFigure } from '../FigureLightbox'
import type { ChartInfo, PendingChart } from '../../types'
import s from './TurnPlots.module.css'

type Props = {
  charts: ChartInfo[]
  pending: PendingChart[]
  /** Topics already pinned, so a pinned figure reads as done. */
  pinnedTopics?: Set<string>
  /** Pin just this figure. The turn-level button pins all of them; a
   *  reviewer usually wants one, and pinning eight to keep one makes the
   *  Opportunities board useless. */
  onPinFigure?: (topic: string) => void
  busy?: boolean
}

/**
 * A turn's figures: the selected chart at full width, with a thumbnail rail
 * beside it when the turn produced more than one.
 *
 * Renders the Vega-Lite spec when the server sent one and falls back to the
 * static PNG otherwise — the same rule the classic PlotPanel follows, because
 * the server emits both and only the spec re-fits when the column is dragged.
 *
 * Charts still rendering appear as placeholders rather than being withheld:
 * `chart_pending` fires when a specialist STARTS charting, while the real
 * `chart` event lands at end-of-turn, and a figure that silently appears
 * minutes later reads as a glitch.
 */
export function TurnPlots({ charts, pending, pinnedTopics, onPinFigure, busy }: Props) {
  const [active, setActive] = useState(0)
  const [zoomed, setZoomed] = useState<LightboxFigure | null>(null)
  const total = charts.length + pending.length
  if (total === 0) {
    return <p className={s.empty}>This turn produced no figures.</p>
  }

  const idx = Math.min(active, charts.length - 1)
  const chart: ChartInfo | undefined = charts[idx]

  return (
    <div className={s.wrap}>
      <div className={s.main}>
        {chart ? (
          <>
            <div className={s.chartHead}>
              <span className={s.chartTitle}>{chart.topic}</span>
              {/* This column is the narrow one, so a chart here is small by
                  construction. Enlarging must not require filing the figure
                  into the report. */}
              {onPinFigure && (
                <button
                  type="button"
                  className={s.pinFig}
                  disabled={busy || pinnedTopics?.has(chart.topic)}
                  onClick={() => onPinFigure(chart.topic)}
                  title={pinnedTopics?.has(chart.topic)
                    ? 'Already pinned' : 'Pin only this figure'}
                >
                  📌 {pinnedTopics?.has(chart.topic) ? 'Pinned' : 'Pin'}
                </button>
              )}
              <button
                type="button"
                className={s.expand}
                onClick={() => setZoomed({
                  title: chart.topic,
                  caption: chart.claim,
                  spec: chart.vega_spec,
                  url: chart.url,
                })}
              >
                ⤢ Enlarge
              </button>
            </div>
            <div className={s.chartBox}>
              {chart.vega_spec ? (
                <VegaChart spec={chart.vega_spec} alt={chart.claim} />
              ) : chart.url ? (
                <img className={s.png} src={chart.url} alt={chart.claim} />
              ) : (
                <p className={s.empty}>No renderable figure for “{chart.topic}”.</p>
              )}
            </div>
            {chart.claim && <p className={s.caption}>{chart.claim}</p>}
          </>
        ) : (
          <p className={s.empty}>Working on the figures…</p>
        )}
      </div>

      {total > 1 && (
        <div className={s.rail} role="tablist" aria-label="Figures on this turn">
          {charts.map((c, i) => (
            <button
              key={`${c.specialist}-${c.topic}`}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={`${s.thumb} ${i === idx ? s.thumbActive : ''}`}
              onClick={() => setActive(i)}
              title={c.claim}
            >
              <span className={s.thumbLabel}>
                Fig {i + 1}{pinnedTopics?.has(c.topic) ? ' 📌' : ''}
              </span>
              <span className={s.thumbTopic}>{c.topic}</span>
            </button>
          ))}
          {pending.map((p) => (
            <span key={`${p.specialist}-${p.topic}`} className={`${s.thumb} ${s.thumbPending}`}>
              <span className={s.thumbLabel}>rendering</span>
              <span className={s.thumbTopic}>{p.topic}</span>
            </span>
          ))}
        </div>
      )}

      <FigureLightbox figure={zoomed} onClose={() => setZoomed(null)} />
    </div>
  )
}
