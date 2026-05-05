import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../hooks/useSSE'
import { useStore } from '../store'
import type { Message } from '../types'

// Minimal EventSource mock supporting both onmessage setter and addEventListener
class MockEventSource {
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {}
  close = vi.fn()
  static instances: MockEventSource[] = []

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners[name]) this.listeners[name] = []
    this.listeners[name].push(fn)
  }

  emit(data: Message, eventName: string = 'message') {
    const ev = { data: JSON.stringify(data) } as MessageEvent
    if (eventName === 'message') this.onmessage?.(ev)
    this.listeners[eventName]?.forEach((fn) => fn(ev))
  }

  emitRaw(raw: string, eventName: string = 'message') {
    const ev = { data: raw } as MessageEvent
    if (eventName === 'message') this.onmessage?.(ev)
    this.listeners[eventName]?.forEach((fn) => fn(ev))
  }

  open() {
    this.onopen?.()
  }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
  useStore.setState({
    caseList: { consumer: [], commercial: [] },
    activeCase: null,
    threads: {},
    turns: {},
    activeTurnId: {},
    sseStatus: 'disconnected',
    unread: new Set(),
  })
})

describe('useSSE', () => {
  it('opens SSE connection for given caseId', () => {
    renderHook(() => useSSE('C-001'))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/cases/C-001/stream')
  })

  it('does nothing when caseId is null', () => {
    renderHook(() => useSSE(null))
    expect(MockEventSource.instances).toHaveLength(0)
    expect(useStore.getState().sseStatus).toBe('disconnected')
  })

  it('sets sseStatus to connected when connection opens', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => { es.open() })
    expect(useStore.getState().sseStatus).toBe('connected')
  })

  it('appends received message to thread', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    const msg: Message = { id: 'm1', role: 'agent', text: 'hello', timestamp: 1 }
    act(() => { es.emit(msg) })
    expect(useStore.getState().threads['C-001']).toHaveLength(1)
    expect(useStore.getState().threads['C-001'][0].text).toBe('hello')
  })

  it('stays connected on parse error (logs but does not disconnect)', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => { es.open() })
    expect(useStore.getState().sseStatus).toBe('connected')
    act(() => { es.emitRaw('not-valid-json') })
    // Parse errors are logged but connection stays open
    expect(useStore.getState().sseStatus).toBe('connected')
  })

  it('closes SSE connection on unmount', () => {
    const { unmount } = renderHook(() => useSSE('C-001'))
    unmount()
    expect(MockEventSource.instances[0].close).toHaveBeenCalled()
  })

  it('closes old and opens new SSE when caseId changes', () => {
    const { rerender } = renderHook(({ id }) => useSSE(id), { initialProps: { id: 'C-001' } })
    rerender({ id: 'C-002' })
    expect(MockEventSource.instances[0].close).toHaveBeenCalled()
    expect(MockEventSource.instances[1].url).toBe('/api/cases/C-002/stream')
  })
})
