import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import type { Message, Turn } from '../types'

const m = (id: string, role: 'agent' | 'reviewer', turn_id?: string): Message =>
  ({ id, role, text: `t-${id}`, timestamp: Date.now(), turn_id })

// A thread message tagged with a turn_id always has a matching Turn record in
// the real app: useSSE creates it (status 'streaming') on `turn_started`,
// before any message carries that id. setCaseHistory relies on that pairing to
// tell an in-flight turn from one the server has dropped.
const turn = (turn_id: string, status: Turn['status']): Turn =>
  ({ turn_id, question: `q-${turn_id}`, started_at: 0, agent_runs: [], status })

beforeEach(() => {
  useStore.setState({ threads: {}, turns: {}, activeTurnId: {}, unread: new Set() })
  localStorage.clear()
})

describe('clearCaseHistory', () => {
  it('clears only the target case', () => {
    useStore.setState({ threads: { A: [m('a1', 'agent')], B: [m('b1', 'agent')] } })
    useStore.getState().clearCaseHistory('A')
    expect(useStore.getState().threads.A ?? []).toHaveLength(0)
    expect(useStore.getState().threads.B).toHaveLength(1)   // untouched
  })
})

describe('setCaseHistory + dedup', () => {
  it('replaces the thread and SSE replay does not duplicate by (turn_id, role)', () => {
    const s = useStore.getState()
    s.setCaseHistory('A', [m('hist:t1:agent', 'agent', 't1')])
    // SSE later replays the same turn's agent message with a DIFFERENT id:
    s.appendMessage('A', m('sse-xyz', 'agent', 't1'))
    expect(useStore.getState().threads.A).toHaveLength(1)   // deduped by (turn_id, role)
  })

  it('clears completed turns when the server returns empty history', () => {
    const s = useStore.getState()
    // A fully rewound / cleared case: the server legitimately has nothing.
    useStore.setState({
      threads: { A: [m('hist:t1:agent', 'agent', 't1')] },
      turns: { A: [turn('t1', 'done')] },
    })
    s.setCaseHistory('A', [])
    expect(useStore.getState().threads.A ?? []).toHaveLength(0)
  })

  it('keeps an untagged optimistic bubble when the server returns empty history', () => {
    const s = useStore.getState()
    useStore.setState({ threads: { A: [m('a1', 'agent')] } })   // no turn_id yet
    s.setCaseHistory('A', [])
    expect(useStore.getState().threads.A).toHaveLength(1)
    expect(useStore.getState().threads.A[0].id).toBe('a1')
  })

  it('drops a completed turn the server no longer lists (rewind survives restart)', () => {
    const s = useStore.getState()
    useStore.setState({
      threads: { A: [m('hist:t1:agent', 'agent', 't1'), m('hist:t2:agent', 'agent', 't2')] },
      turns: { A: [turn('t1', 'done'), turn('t2', 'done')] },
    })
    s.setCaseHistory('A', [m('hist:t1:agent', 'agent', 't1')])
    const thread = useStore.getState().threads.A
    expect(thread).toHaveLength(1)
    expect(thread.some((msg) => msg.turn_id === 't2')).toBe(false)
  })

  it('preserves an in-flight local message not represented in server history', () => {
    const s = useStore.getState()
    useStore.setState({
      threads: { A: [m('hist:t1:agent', 'agent', 't1'), m('inflight:t2:reviewer', 'reviewer', 't2')] },
      turns: { A: [turn('t1', 'done'), turn('t2', 'streaming')] },
    })
    // Server only knows about the completed turn t1.
    s.setCaseHistory('A', [m('hist:t1:agent', 'agent', 't1')])
    const thread = useStore.getState().threads.A
    expect(thread).toHaveLength(2)
    expect(thread.some((msg) => msg.id === 'inflight:t2:reviewer')).toBe(true)
  })

  it('dedups a replayed reviewer message by (turn_id, role)', () => {
    const s = useStore.getState()
    s.setCaseHistory('A', [m('hist:t1:reviewer', 'reviewer', 't1')])
    // SSE later replays the same turn's reviewer message with a DIFFERENT id:
    s.appendMessage('A', m('sse-abc', 'reviewer', 't1'))
    expect(useStore.getState().threads.A).toHaveLength(1)
  })
})
