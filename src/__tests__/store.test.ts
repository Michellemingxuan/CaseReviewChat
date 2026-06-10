import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import type { ChartInfo, Message, Turn } from '../types'

const msg = (id: string, role: 'agent' | 'reviewer'): Message => ({
  id,
  role,
  text: `text-${id}`,
  timestamp: Date.now(),
})

beforeEach(() => {
  // Reset every persisted slice between tests — incomplete reset (e.g.
  // forgetting `turns`) lets state leak across cases and produces
  // confusing failures like "expected 1 turn, got 3".
  useStore.setState({
    caseList: [],
    activeCase: null,
    threads: {},
    turns: {},
    activeTurnId: {},
    sseStatus: 'disconnected',
    unread: new Set(),
  })
  localStorage.clear()
})

describe('store', () => {
  it('appendMessage dedupes by id (replay-on-reconnect safe)', () => {
    useStore.getState().appendMessage('C-1', msg('m1', 'agent'))
    // Same id arrives again (SSE replay after a reconnect) — must not double.
    useStore.getState().appendMessage('C-1', msg('m1', 'agent'))
    expect(useStore.getState().threads['C-1']).toHaveLength(1)
    // A different id still appends.
    useStore.getState().appendMessage('C-1', msg('m2', 'agent'))
    expect(useStore.getState().threads['C-1']).toHaveLength(2)
  })

  it('setActiveCase updates activeCase and clears unread for that case', () => {
    useStore.setState({ unread: new Set(['C-001']) })
    useStore.getState().setActiveCase('C-001')
    expect(useStore.getState().activeCase).toBe('C-001')
    expect(useStore.getState().unread.has('C-001')).toBe(false)
  })

  it('appendMessage adds message to thread', () => {
    useStore.getState().appendMessage('C-001', msg('m1', 'agent'))
    expect(useStore.getState().threads['C-001']).toHaveLength(1)
  })

  it('rewindThread drops the owning reviewer + everything after, returns reviewer text', () => {
    // Thread shape: r1 → a1 → r2 → a2.  Rewinding from a2 should walk back
    // to r2 (the reviewer that owns this turn) and drop r2 + a2 from the
    // thread, leaving [r1, a1]. The reviewer's text is returned so the
    // caller can prefill the input box.
    useStore.getState().appendMessage('C-001', msg('r1', 'reviewer'))
    useStore.getState().appendMessage('C-001', msg('a1', 'agent'))
    useStore.getState().appendMessage('C-001', msg('r2', 'reviewer'))
    useStore.getState().appendMessage('C-001', msg('a2', 'agent'))

    const text = useStore.getState().rewindThread('C-001', 'a2')
    expect(text).toBe('text-r2')
    const thread = useStore.getState().threads['C-001']
    expect(thread).toHaveLength(2)
    expect(thread.map((m) => m.id)).toEqual(['r1', 'a1'])
  })

  it('rewindThread on a reviewer bubble drops that reviewer too', () => {
    // Click rewind directly on a reviewer bubble: drop it + everything after.
    useStore.getState().appendMessage('C-001', msg('r1', 'reviewer'))
    useStore.getState().appendMessage('C-001', msg('a1', 'agent'))
    useStore.getState().appendMessage('C-001', msg('r2', 'reviewer'))

    const text = useStore.getState().rewindThread('C-001', 'r2')
    expect(text).toBe('text-r2')
    expect(useStore.getState().threads['C-001'].map((m) => m.id))
      .toEqual(['r1', 'a1'])
  })

  it('setCaseList sets caseList', () => {
    useStore.getState().setCaseList(['C-001', 'C-002'])
    expect(useStore.getState().caseList).toEqual(['C-001', 'C-002'])
  })

  it('setSseStatus updates sseStatus', () => {
    useStore.getState().setSseStatus('connected')
    expect(useStore.getState().sseStatus).toBe('connected')
  })

  it('markUnread adds caseId to unread set', () => {
    useStore.getState().markUnread('C-002')
    expect(useStore.getState().unread.has('C-002')).toBe(true)
  })

  // ── upsertChart ────────────────────────────────────────────────────────

  const baseTurn = (id: string): Turn => ({
    turn_id: id,
    question: 'q',
    started_at: 1,
    agent_runs: [],
    status: 'streaming',
  })

  const chart = (specialist: string, topic: string, url: string): ChartInfo => ({
    specialist, topic, url, claim: '', source_call: '', kind: 'trend',
    vega_spec: null,
  })

  it('upsertChart appends a chart to the matching turn', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().upsertChart('C-001', 't1', chart('modeling', 'fico_trend', '/u1.png'))
    const turns = useStore.getState().turns['C-001']
    expect(turns[0].charts).toHaveLength(1)
    expect(turns[0].charts?.[0].url).toBe('/u1.png')
  })

  it('upsertChart dedupes by (specialist, topic) — latest wins', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().upsertChart('C-001', 't1', chart('modeling', 'fico_trend', '/v1.png'))
    useStore.getState().upsertChart('C-001', 't1', chart('modeling', 'fico_trend', '/v2.png'))
    // Different topic, same specialist — independent.
    useStore.getState().upsertChart('C-001', 't1', chart('modeling', 'delinq_trend', '/v3.png'))
    // Same topic, different specialist — independent.
    useStore.getState().upsertChart('C-001', 't1', chart('bureau', 'fico_trend', '/v4.png'))

    const charts = useStore.getState().turns['C-001'][0].charts ?? []
    expect(charts).toHaveLength(3)  // 4 emitted, 1 deduped
    const fico = charts.find((c) => c.specialist === 'modeling' && c.topic === 'fico_trend')
    expect(fico?.url).toBe('/v2.png')  // latest wins
  })

  it('upsertChart on an unknown turn_id is a no-op (no orphan turns)', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().upsertChart('C-001', 'unknown', chart('modeling', 'x', '/p.png'))
    const turns = useStore.getState().turns['C-001']
    expect(turns).toHaveLength(1)
    expect(turns[0].charts ?? []).toHaveLength(0)
  })

  // ── upsertPendingChart + chart→pending clearing ──────────────────────────

  it('upsertPendingChart adds a placeholder keyed by (specialist, topic)', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'modeling', topic: 'fico', kind: 'trend_dual' })
    const pending = useStore.getState().turns['C-001'][0].pendingCharts ?? []
    expect(pending).toHaveLength(1)
    expect(pending[0]).toEqual({ specialist: 'modeling', topic: 'fico', kind: 'trend_dual' })
  })

  it('upsertPendingChart dedupes — duplicate (specialist, topic) is a no-op', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'modeling', topic: 'fico', kind: 'trend' })
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'modeling', topic: 'fico', kind: 'trend' })
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'modeling', topic: 'other', kind: 'bar' })
    const pending = useStore.getState().turns['C-001'][0].pendingCharts ?? []
    expect(pending).toHaveLength(2)
  })

  it('upsertChart clears matching pendingCharts entry', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    // Two pendings; the chart event matches the first one.
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'modeling', topic: 'fico', kind: 'trend' })
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'bureau',   topic: 'utilization', kind: 'bar' })
    useStore.getState().upsertChart('C-001', 't1', chart('modeling', 'fico', '/u.png'))

    const turn = useStore.getState().turns['C-001'][0]
    expect(turn.charts).toHaveLength(1)
    // Only the bureau/utilization pending remains.
    expect(turn.pendingCharts).toHaveLength(1)
    expect(turn.pendingCharts?.[0].specialist).toBe('bureau')
  })

  it('upsertPendingChart is a no-op when the real chart has already arrived', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().upsertChart('C-001', 't1', chart('modeling', 'fico', '/u.png'))
    // Late `chart_pending` event for an already-arrived chart — should NOT
    // produce a placeholder that the user would have to stare at.
    useStore.getState().upsertPendingChart('C-001', 't1',
      { specialist: 'modeling', topic: 'fico', kind: 'trend' })
    const turn = useStore.getState().turns['C-001'][0]
    expect(turn.pendingCharts ?? []).toHaveLength(0)
    expect(turn.charts).toHaveLength(1)
  })

  // ── startTurn activeTurnId behaviour ───────────────────────────────────

  it('startTurn auto-promotes activeTurnId when user is on the latest turn', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    expect(useStore.getState().activeTurnId['C-001']).toBe('t1')
    useStore.getState().startTurn('C-001', baseTurn('t2'))
    expect(useStore.getState().activeTurnId['C-001']).toBe('t2')
  })

  it('startTurn preserves activeTurnId when user has clicked back to an older turn', () => {
    // Two turns already exist; user clicks the older turn to inspect it.
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().startTurn('C-001', baseTurn('t2'))
    useStore.getState().setActiveTurn('C-001', 't1')
    expect(useStore.getState().activeTurnId['C-001']).toBe('t1')

    // Now a new turn starts (server emits turn_started for a fresh
    // question). The user is intentionally viewing an older turn — their
    // selection must NOT be clobbered by the new turn's arrival.
    useStore.getState().startTurn('C-001', baseTurn('t3'))
    expect(useStore.getState().activeTurnId['C-001']).toBe('t1')
  })

  it('startTurn auto-promotes when activeTurnId is null', () => {
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().setActiveTurn('C-001', null)
    useStore.getState().startTurn('C-001', baseTurn('t2'))
    expect(useStore.getState().activeTurnId['C-001']).toBe('t2')
  })

  it('startTurn dedupes by turn_id (replay-on-reconnect safe)', () => {
    // The backend replays buffered events (including `turn_started`) on
    // every SSE reconnect — and a hard-refresh triggers a reconnect. Without
    // dedup, each replay re-appended the same turn, inflating the
    // "Turn X of N" navigator (e.g. 2 real turns showing as 8).
    useStore.getState().startTurn('C-001', baseTurn('t1'))
    useStore.getState().startTurn('C-001', baseTurn('t1')) // replayed turn_started
    expect(useStore.getState().turns['C-001']).toHaveLength(1)
    // A genuinely new turn still appends.
    useStore.getState().startTurn('C-001', baseTurn('t2'))
    expect(useStore.getState().turns['C-001']).toHaveLength(2)
    // The duplicate must not have disturbed the existing turn's identity.
    expect(useStore.getState().turns['C-001'].map((t) => t.turn_id))
      .toEqual(['t1', 't2'])
  })
})
