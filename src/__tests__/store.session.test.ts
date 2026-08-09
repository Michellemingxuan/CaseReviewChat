import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import type { Message } from '../types'

const m = (id: string, role: 'agent' | 'reviewer', turn_id?: string): Message =>
  ({ id, role, text: `t-${id}`, timestamp: Date.now(), turn_id })

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

  it('does not wipe the local thread when the server returns empty history', () => {
    const s = useStore.getState()
    useStore.setState({ threads: { A: [m('a1', 'agent')] } })
    s.setCaseHistory('A', [])
    expect(useStore.getState().threads.A).toHaveLength(1)
    expect(useStore.getState().threads.A[0].id).toBe('a1')
  })

  it('preserves an in-flight local message not represented in server history', () => {
    const s = useStore.getState()
    useStore.setState({
      threads: { A: [m('hist:t1:agent', 'agent', 't1'), m('inflight:t2:reviewer', 'reviewer', 't2')] },
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
