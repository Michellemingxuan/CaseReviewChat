import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import type { Message } from '../types'

const msg = (id: string, role: 'agent' | 'reviewer'): Message => ({
  id,
  role,
  text: `text-${id}`,
  timestamp: Date.now(),
})

beforeEach(() => {
  // Reset store between tests
  useStore.setState({
    caseList: [],
    activeCase: null,
    threads: {},
    sseStatus: 'disconnected',
    unread: new Set(),
  })
  localStorage.clear()
})

describe('store', () => {
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
})
