import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { TurnPlots } from './TurnPlots'
import { figureCount, type TurnView } from './turns'
import { useTextSelection } from './useTextSelection'
import s from './TurnCard.module.css'

/**
 * Answers routinely contain wide comparison tables (pattern / merchant /
 * timing), and the assistant column is the narrow one. Without a scroller the
 * table is clipped by the card and the right-hand columns are unreachable —
 * the same failure the report panel had. Same fix, same reason.
 */
const MD = {
  table: ({ children, ...props }: { children?: React.ReactNode }) => (
    <div className={s.tableScroll}>
      <table {...props}>{children}</table>
    </div>
  ),
}

type Props = {
  view: TurnView
  expanded: boolean
  onToggle: () => void
  /** Pin a claim from this turn. `text` is the reviewer's selection when
   *  they highlighted one, or the whole answer when they did not. */
  onPinInsight: (view: TurnView, text: string) => void
  /** Pin one figure, or every figure on the turn when `topic` is omitted. */
  onPinFigures: (view: TurnView, topic?: string) => void
  onRewind: (view: TurnView) => void
  /** Pin ids already stored for this turn, so the buttons can read as done. */
  pinnedFigureTopics: Set<string>
  busy?: boolean
}

type Tab = 'answer' | 'plots'

const time = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

/**
 * One turn: the question as a clickable row, and — when expanded — the answer
 * card with its Answer / Plots tabs and pin actions.
 *
 * Collapsed by default for every turn but the last, which is what the design
 * shows: turns 1 and 2 are one-line rows, 3 and 4 are open. A long review
 * session is mostly history, and history should be scannable.
 */
export function TurnCard({
  view, expanded, onToggle, onPinInsight, onPinFigures, onRewind,
  pinnedFigureTopics, busy,
}: Props) {
  const [tab, setTab] = useState<Tab>('answer')
  const answerRef = useRef<HTMLDivElement | null>(null)
  const { text: selection, clear: clearSelection } = useTextSelection(answerRef)
  const figures = figureCount(view)
  const allFiguresPinned =
    view.charts.length > 0 && view.charts.every((c) => pinnedFigureTopics.has(c.topic))

  return (
    <article className={s.turn}>
      <button
        type="button"
        className={`${s.qRow} ${expanded ? s.qRowOpen : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={s.turnNo}>Turn {view.index}</span>
        <span className={s.question}>{view.question}</span>
        <span className={s.time}>{time(view.askedAt)}</span>
        <span className={s.chevron} aria-hidden="true">{expanded ? '⌄' : '›'}</span>
      </button>

      {expanded && (
        <div className={s.card}>
          <div className={s.tabs} role="tablist" aria-label={`Turn ${view.index} content`}>
            <button
              type="button" role="tab" aria-selected={tab === 'answer'}
              className={`${s.tab} ${tab === 'answer' ? s.tabActive : ''}`}
              onClick={() => setTab('answer')}
            >
              Answer
            </button>
            <button
              type="button" role="tab" aria-selected={tab === 'plots'}
              className={`${s.tab} ${tab === 'plots' ? s.tabActive : ''}`}
              onClick={() => setTab('plots')}
              disabled={figures === 0}
              title={figures === 0 ? 'This turn produced no figures' : undefined}
            >
              Plots
              {figures > 0 && <span className={s.badge}>{figures}</span>}
            </button>
          </div>

          <div className={s.body}>
            {tab === 'answer' && (
              view.answer
                ? <div className={s.answer} ref={answerRef}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={MD}
                    >
                      {view.answer}
                    </ReactMarkdown>
                  </div>
                : view.status === 'error'
                  ? <p className={s.error}>{view.error ?? 'This turn did not complete.'}</p>
                  : <p className={s.thinking}>Working on it…</p>
            )}
            {/* Mounted only while selected: vega-embed measures its parent on
                first render and never recovers from a hidden 0x0 box. */}
            {tab === 'plots' && (
              <TurnPlots
                charts={view.charts}
                pending={view.pendingCharts}
                pinnedTopics={pinnedFigureTopics}
                onPinFigure={(topic) => onPinFigures(view, topic)}
                busy={busy}
              />
            )}
          </div>

          {selection && tab === 'answer' && (
            <div className={s.selectionNote}>
              <span className={s.selectionLabel}>Selected</span>
              <span className={s.selectionText}>“{selection}”</span>
            </div>
          )}

          <div className={s.actions}>
            <button
              type="button"
              className={`${s.pinBtn} ${selection ? s.pinBtnArmed : ''}`}
              disabled={!view.answer || busy}
              onClick={() => {
                onPinInsight(view, selection || view.answer || '')
                clearSelection()
              }}
              title={selection
                ? 'Pin just the highlighted sentence'
                : 'Highlight a sentence first to pin only that claim'}
            >
              📌 {selection ? 'Pin selection' : 'Pin Insight'}
            </button>
            <button
              type="button" className={s.pinBtn}
              disabled={view.charts.length === 0 || allFiguresPinned || busy}
              onClick={() => onPinFigures(view)}
              title={allFiguresPinned ? 'Already pinned' : 'Pin every figure on this turn'}
            >
              📌 {allFiguresPinned ? 'Figures pinned' : 'Pin all figures'}
            </button>
            <button
              type="button" className={s.ghostBtn} onClick={() => onRewind(view)}
              title="Drop this turn and everything after it, and put the question back in the box"
            >
              ↺ Rewind
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
