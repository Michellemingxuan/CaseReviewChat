import { describe, it, expect } from 'vitest'
import { buildTurnViews, figureCount } from '../journey/chat/turns'
import type { ChartInfo, Message, Turn } from '../types'

const msg = (over: Partial<Message> & Pick<Message, 'role' | 'text'>): Message => ({
  id: over.id ?? `m-${Math.random()}`, ...over,
} as Message)

const chart = (topic: string): ChartInfo => ({
  specialist: 'modeling', topic, url: `/c/${topic}.png`, claim: 'c', source_call: '', kind: 'trend',
})

const turn = (over: Partial<Turn> & Pick<Turn, 'turn_id'>): Turn => ({
  question: 'q', started_at: 0, agent_runs: [], status: 'done', ...over,
} as Turn)

describe('buildTurnViews', () => {
  it('pairs each question with the answer that follows it', () => {
    const views = buildTurnViews([
      msg({ role: 'reviewer', text: 'Q1', turn_id: 't1' }),
      msg({ role: 'agent', text: 'A1', turn_id: 't1' }),
      msg({ role: 'reviewer', text: 'Q2', turn_id: 't2' }),
      msg({ role: 'agent', text: 'A2', turn_id: 't2' }),
    ], [turn({ turn_id: 't1' }), turn({ turn_id: 't2' })])

    expect(views.map((v) => [v.index, v.question, v.answer]))
      .toEqual([[1, 'Q1', 'A1'], [2, 'Q2', 'A2']])
  })

  it('attaches each turn its own charts', () => {
    const views = buildTurnViews([
      msg({ role: 'reviewer', text: 'Q1', turn_id: 't1' }),
      msg({ role: 'agent', text: 'A1', turn_id: 't1' }),
      msg({ role: 'reviewer', text: 'Q2', turn_id: 't2' }),
      msg({ role: 'agent', text: 'A2', turn_id: 't2' }),
    ], [
      turn({ turn_id: 't1', charts: [chart('tsr'), chart('bureau')] }),
      turn({ turn_id: 't2', charts: [chart('spend')] }),
    ])

    expect(figureCount(views[0])).toBe(2)
    expect(figureCount(views[1])).toBe(1)
    expect(views[1].charts[0].topic).toBe('spend')
  })

  it('adopts the turn_id from the answer when the question was optimistic', () => {
    // The reviewer bubble is appended locally before `turn_started` lands,
    // so it carries no turn_id — without adopting one, its charts are lost.
    const views = buildTurnViews([
      msg({ role: 'reviewer', text: 'Q1' }),
      msg({ role: 'agent', text: 'A1', turn_id: 't1' }),
    ], [turn({ turn_id: 't1', charts: [chart('tsr')] })])

    expect(views[0].turnId).toBe('t1')
    expect(figureCount(views[0])).toBe(1)
  })

  it('leaves an unanswered question streaming', () => {
    const views = buildTurnViews(
      [msg({ role: 'reviewer', text: 'Q1', turn_id: 't1' })],
      [turn({ turn_id: 't1', status: 'streaming' })],
    )
    expect(views[0].answer).toBeNull()
    expect(views[0].status).toBe('streaming')
  })

  it('counts pending charts so the badge appears before rendering finishes', () => {
    const views = buildTurnViews(
      [msg({ role: 'reviewer', text: 'Q1', turn_id: 't1' })],
      [turn({
        turn_id: 't1', status: 'streaming',
        charts: [chart('tsr')],
        pendingCharts: [{ specialist: 'spends', topic: 'merchant', kind: 'bar' }],
      })],
    )
    expect(figureCount(views[0])).toBe(2)
  })

  it('treats server-restored history with no trace rows as done', () => {
    // `/history` returns messages but no reasoning trace; without this the
    // whole restored thread would render as perpetually streaming.
    const views = buildTurnViews([
      msg({ role: 'reviewer', text: 'Q1' }),
      msg({ role: 'agent', text: 'A1' }),
    ], [])
    expect(views[0].status).toBe('done')
  })

  it('surfaces a turn error on its view', () => {
    const views = buildTurnViews(
      [msg({ role: 'reviewer', text: 'Q1', turn_id: 't1' })],
      [turn({ turn_id: 't1', status: 'error', error: 'boom', errorKind: 'interrupted' })],
    )
    expect(views[0].status).toBe('error')
    expect(views[0].error).toBe('boom')
  })

  it('renumbers turns after a rewind drops the tail', () => {
    const views = buildTurnViews([
      msg({ role: 'reviewer', text: 'Q1', turn_id: 't1' }),
      msg({ role: 'agent', text: 'A1', turn_id: 't1' }),
    ], [turn({ turn_id: 't1' })])
    expect(views.map((v) => v.index)).toEqual([1])
  })
})
