import type { ChartInfo, Message, PendingChart, Turn } from '../../types'

/**
 * One reviewer question and the answer to it, with that turn's figures.
 *
 * The store keeps two parallel records of a turn: `threads[case]` holds the
 * chat MESSAGES, `turns[case]` holds the reasoning TRACE (and the charts).
 * The classic UI rendered them in separate panels so it never had to line
 * them up. The journey design puts the answer and its plots in one card, so
 * something has to join them — this is that join, kept as a pure function so
 * it can be tested without a DOM.
 */
export type TurnView = {
  /** Null until the server assigns one (the optimistic reviewer bubble
   *  exists for a beat before `turn_started` lands). */
  turnId: string | null
  /** 1-based, for the "TURN 3" label. Positional, not derived from the
   *  server — a rewind renumbers what remains, which is what a reviewer
   *  reading top-to-bottom expects. */
  index: number
  question: string
  answer: string | null
  askedAt?: number
  /** Message id of the reviewer bubble, for rewind. */
  questionMessageId?: string
  charts: ChartInfo[]
  pendingCharts: PendingChart[]
  status: 'streaming' | 'done' | 'error'
  error?: string
  errorKind?: string
}

const EMPTY_CHARTS: ChartInfo[] = []
const EMPTY_PENDING: PendingChart[] = []

/**
 * Pair messages into turns and attach each turn's charts.
 *
 * Walks messages in order rather than grouping by `turn_id`, because
 * `turn_id` is not always present: an optimistically-appended reviewer
 * bubble carries none until the server echoes the turn back. Ordering is
 * the one thing always available, so it drives the pairing and `turn_id`
 * only refines it.
 */
export function buildTurnViews(messages: Message[], turns: Turn[]): TurnView[] {
  const byId = new Map(turns.map((t) => [t.turn_id, t]))
  const views: TurnView[] = []

  for (const msg of messages) {
    if (msg.role === 'reviewer') {
      views.push({
        turnId: msg.turn_id ?? null,
        index: views.length + 1,
        question: msg.text,
        answer: null,
        askedAt: msg.timestamp,
        questionMessageId: msg.id,
        charts: EMPTY_CHARTS,
        pendingCharts: EMPTY_PENDING,
        status: 'streaming',
      })
      continue
    }
    // Agent message: fill the most recent unanswered turn. Falling back to
    // the last view (rather than dropping the message) matters on a
    // regenerate, where a second answer arrives for a turn already answered
    // — showing the newer text beats silently discarding it.
    const target = [...views].reverse().find((v) => v.answer === null) ?? views[views.length - 1]
    if (!target) continue
    target.answer = msg.text
    // An agent message is the first place a server turn_id appears for a
    // locally-created bubble; adopt it so the charts can be found.
    if (!target.turnId && msg.turn_id) target.turnId = msg.turn_id
  }

  // Attach trace-side state now that every view knows its turn_id.
  for (const v of views) {
    const t = v.turnId ? byId.get(v.turnId) : undefined
    if (!t) {
      // No trace row yet. An answered turn with no trace is `done` (history
      // restored from the server carries messages but no trace); an
      // unanswered one is still in flight.
      v.status = v.answer !== null ? 'done' : 'streaming'
      continue
    }
    v.charts = t.charts ?? EMPTY_CHARTS
    v.pendingCharts = t.pendingCharts ?? EMPTY_PENDING
    v.status = t.status
    v.error = t.error
    v.errorKind = t.errorKind
  }

  return views
}

/** Total figures on a turn, real and still-rendering — the count badge. */
export function figureCount(v: TurnView): number {
  return v.charts.length + v.pendingCharts.length
}
