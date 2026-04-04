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

  it('rewindThread truncates thread after the given messageId (inclusive)', () => {
    useStore.getState().appendMessage('C-001', msg('m1', 'agent'))
    useStore.getState().appendMessage('C-001', msg('m2', 'reviewer'))
    useStore.getState().appendMessage('C-001', msg('m3', 'agent'))
    useStore.getState().rewindThread('C-001', 'm1')
    expect(useStore.getState().threads['C-001']).toHaveLength(1)
    expect(useStore.getState().threads['C-001'][0].id).toBe('m1')
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
