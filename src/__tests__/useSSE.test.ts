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

  it('chart event lands on the matching turn via upsertChart', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]

    // Seed a streaming turn first — chart events that target an unknown
    // turn_id are no-ops (matches the store's design).
    act(() => {
      es.emit({ turn_id: 't1', question: 'q', started_at: 1 } as unknown as Message,
              'turn_started')
    })

    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1',
          specialist: 'modeling',
          topic: 'fico_trajectory',
          url: '/api/cases/C-001/charts/t1-fico_trajectory.png',
          claim: 'FICO 720 → 645 over 6 months.',
          source_call: "summarize_trend('bureau','fico_score',...)",
          kind: 'trend',
          vega_spec: null,
        }),
        'chart',
      )
    })

    const turn = useStore.getState().turns['C-001'][0]
    expect(turn.charts).toHaveLength(1)
    expect(turn.charts?.[0].topic).toBe('fico_trajectory')
    expect(turn.charts?.[0].url).toContain('fico_trajectory.png')
  })

  it('error event with recoverable=true does NOT mark the turn errored', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => {
      es.emit({ turn_id: 't1', question: 'q', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1',
          message: 'one specialist failed but turn continues',
          recoverable: true,
        }),
        'error',
      )
    })
    const turn = useStore.getState().turns['C-001'][0]
    // Turn must NOT be flipped to error — the orchestrator can still produce
    // a final answer from the other specialists.
    expect(turn.status).toBe('streaming')
    expect(turn.error).toBeUndefined()
  })

  it('error event without recoverable flag DOES mark the turn errored', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => {
      es.emit({ turn_id: 't1', question: 'q', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    act(() => {
      es.emitRaw(
        JSON.stringify({ turn_id: 't1', message: 'orchestrator hard fail' }),
        'error',
      )
    })
    const turn = useStore.getState().turns['C-001'][0]
    expect(turn.status).toBe('error')
    expect(turn.error).toContain('orchestrator hard fail')
  })
})
