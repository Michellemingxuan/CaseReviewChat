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

  it('recoverable error with specialist name attaches to turn.errorsBySpecialist (not lost)', () => {
    // Regression: before this fix, an `error` SSE event with
    // `recoverable: true` returned early without storing anything —
    // recoverable specialist failures (max_turns, timeout) were
    // silently dropped on the floor. The reasoning-trace panel then
    // showed the failed specialist as "no result" or "idle" instead
    // of surfacing the actual failure reason. Now the per-specialist
    // error is stored under `errorsBySpecialist` so the
    // OrchestrationFlowPanel can render the precise reason on the
    // matching agent node.
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
          message: 'hit the 15-turn budget — partial findings were not returned.',
          recoverable: true,
          specialist: 'modeling',
          error_type: 'max_turns_exceeded',
        }),
        'error',
      )
    })
    const turn = useStore.getState().turns['C-001'][0]
    // Turn-level status NOT flipped to 'error' — orchestrator can still
    // synthesize from the other specialists.
    expect(turn.status).toBe('streaming')
    // BUT the per-specialist error IS stored.
    expect(turn.errorsBySpecialist).toBeDefined()
    expect(turn.errorsBySpecialist?.modeling).toContain('max_turns_exceeded')
    expect(turn.errorsBySpecialist?.modeling).toContain('15-turn budget')
  })

  it('multiple recoverable errors for different specialists all attach', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => {
      es.emit({ turn_id: 't1', question: 'q', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    act(() => {
      es.emitRaw(JSON.stringify({
        turn_id: 't1', message: 'timeout', recoverable: true,
        specialist: 'modeling', error_type: 'timeout',
      }), 'error')
    })
    act(() => {
      es.emitRaw(JSON.stringify({
        turn_id: 't1', message: 'transport error', recoverable: true,
        specialist: 'bureau', error_type: 'TransportError',
      }), 'error')
    })
    const turn = useStore.getState().turns['C-001'][0]
    expect(Object.keys(turn.errorsBySpecialist ?? {})).toEqual(
      expect.arrayContaining(['modeling', 'bureau']),
    )
  })

  it('error event carries `kind` (e.g. interrupted) onto the turn for the orchestration flow', () => {
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
          message: 'Interrupted — the answer was stopped.',
          recoverable: false,
          kind: 'interrupted',
        }),
        'error',
      )
    })
    const turn = useStore.getState().turns['C-001'][0]
    expect(turn.status).toBe('error')
    expect(turn.errorKind).toBe('interrupted')
  })

  it('turn_done after an `interrupted` error preserves status=error (does not flip to done)', () => {
    // Regression: pressing Stop should leave the orchestration-flow
    // panel showing the interruption indicator. The backend emits
    // `error` (kind=interrupted) THEN `turn_done` (outcome=aborted).
    // Without the preservation tweak in useSSE.turn_done, the second
    // event would clobber status='error' with 'done' and the panel
    // would lose the interruption visual the instant turn_done lands.
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
          message: 'Interrupted',
          recoverable: false,
          kind: 'interrupted',
        }),
        'error',
      )
    })
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1',
          ended_at: 100,
          duration_ms: 99,
          outcome: 'aborted',
        }),
        'turn_done',
      )
    })
    const turn = useStore.getState().turns['C-001'][0]
    expect(turn.status).toBe('error')        // preserved, not flipped
    expect(turn.outcome).toBe('aborted')     // still recorded
    expect(turn.duration_ms).toBe(99)        // turn_done's other fields still applied
    expect(turn.errorKind).toBe('interrupted')
  })

  it('turn_done with non-error prior status still goes to status=done', () => {
    // Negative case: when no error preceded turn_done, the standard
    // streaming → done transition still works. Guards against the
    // preservation tweak accidentally pinning EVERY turn to its
    // prior status.
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
          ended_at: 100,
          duration_ms: 99,
          outcome: 'ok',
        }),
        'turn_done',
      )
    })
    expect(useStore.getState().turns['C-001'][0].status).toBe('done')
  })

  it('chart_pending event adds a placeholder visible until the chart arrives', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => {
      es.emit({ turn_id: 't1', question: 'q', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    // Specialist calls make_chart — server emits chart_pending immediately.
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1',
          specialist: 'modeling',
          topic: 'fico_trajectory',
          kind: 'trend_dual',
        }),
        'chart_pending',
      )
    })

    let turn = useStore.getState().turns['C-001'][0]
    expect(turn.pendingCharts).toHaveLength(1)
    expect(turn.pendingCharts?.[0].specialist).toBe('modeling')
    expect(turn.pendingCharts?.[0].kind).toBe('trend_dual')
    expect(turn.charts ?? []).toHaveLength(0)

    // Matching chart event arrives → pending placeholder is cleared.
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1',
          specialist: 'modeling',
          topic: 'fico_trajectory',
          url: '/api/cases/C-001/charts/t1-fico_trajectory.png',
          kind: 'trend_dual',
        }),
        'chart',
      )
    })
    turn = useStore.getState().turns['C-001'][0]
    expect(turn.pendingCharts ?? []).toHaveLength(0)
    expect(turn.charts).toHaveLength(1)
  })

  it('orchestrator_retry resets the prior attempt mid-stream state', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    act(() => {
      es.emit({ turn_id: 't1', question: 'q', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    // Seed prior-attempt state so we can confirm reset wipes it.
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1',
          tool_calls: [{ call_id: 'a', tool: 'modeling', sub_question: 'q1' }],
        }),
        'team_plan',
      )
    })
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't1', call_id: 'a', tool: 'modeling', started_at: 1,
        }),
        'agent_started',
      )
    })

    let turn = useStore.getState().turns['C-001'][0]
    expect(turn.team_plan).toHaveLength(1)
    expect(turn.agent_runs).toHaveLength(1)

    act(() => {
      es.emitRaw(
        JSON.stringify({ turn_id: 't1', attempt: 1, reason: 'model_behavior_error' }),
        'orchestrator_retry',
      )
    })

    turn = useStore.getState().turns['C-001'][0]
    expect(turn.team_plan).toBeUndefined()
    expect(turn.agent_runs).toHaveLength(0)
  })

  it('question_check.passed=false snaps activeTurnId to the rejected turn', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]

    // Seed TWO prior turns so we can click back to t1 as a historical
    // selection — startTurn only blocks auto-promote when the user was
    // on a turn that is NOT the latest.
    act(() => {
      es.emit({ turn_id: 't1', question: 'q1', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    act(() => {
      es.emit({ turn_id: 't2', question: 'q2', started_at: 2 } as unknown as Message,
              'turn_started')
    })
    // User clicks back to t1 (the historical turn).
    act(() => {
      useStore.getState().setActiveTurn('C-001', 't1')
    })
    // New turn starts — selection priority leaves user on t1.
    act(() => {
      es.emit({ turn_id: 't3', question: 'what to eat', started_at: 3 } as unknown as Message,
              'turn_started')
    })
    expect(useStore.getState().activeTurnId['C-001']).toBe('t1')

    // Rejection fires — activeTurnId snaps to the rejected turn so the
    // user sees the answer.
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't3', passed: false,
          reason: 'out of scope',
          redacted_question: 'what to eat',
          in_scope: false,
          outcome: 'screen_rejected',
        }),
        'question_check',
      )
    })
    expect(useStore.getState().activeTurnId['C-001']).toBe('t3')
  })

  it('question_check.passed=true does NOT change activeTurnId', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]

    act(() => {
      es.emit({ turn_id: 't1', question: 'q1', started_at: 1 } as unknown as Message,
              'turn_started')
    })
    act(() => {
      es.emit({ turn_id: 't2', question: 'q2', started_at: 2 } as unknown as Message,
              'turn_started')
    })
    act(() => {
      useStore.getState().setActiveTurn('C-001', 't1')
    })
    act(() => {
      es.emit({ turn_id: 't3', question: 'real review q', started_at: 3 } as unknown as Message,
              'turn_started')
    })
    expect(useStore.getState().activeTurnId['C-001']).toBe('t1')

    // Accepted question — user stays on t1 (memory rule: reviewers
    // look back during long streaming turns).
    act(() => {
      es.emitRaw(
        JSON.stringify({
          turn_id: 't3', passed: true,
          reason: '',
          redacted_question: 'real review q',
          in_scope: true,
          outcome: 'ok',
        }),
        'question_check',
      )
    })
    expect(useStore.getState().activeTurnId['C-001']).toBe('t1')
  })

  // ─── Reconnect behavior ────────────────────────────────────────────────
  //
  // Regression coverage for the "asked a new question after long idle and
  // got no reasoning trace" symptom. The fix added exponential backoff
  // capped at 30s, plus visibilitychange / online listeners that force an
  // immediate reconnect when the tab returns to foreground or the network
  // comes back.

  describe('reconnect', () => {
    it('uses exponential backoff after onerror (1s, 2s, 4s, …)', () => {
      vi.useFakeTimers()
      try {
        renderHook(() => useSSE('C-001'))
        const first = MockEventSource.instances[0]
        // First failure → 1s delay
        act(() => { first.onerror?.() })
        expect(MockEventSource.instances).toHaveLength(1)
        act(() => { vi.advanceTimersByTime(999) })
        expect(MockEventSource.instances).toHaveLength(1)
        act(() => { vi.advanceTimersByTime(1) })
        expect(MockEventSource.instances).toHaveLength(2)

        // Second failure → 2s delay (no successful open between)
        const second = MockEventSource.instances[1]
        act(() => { second.onerror?.() })
        act(() => { vi.advanceTimersByTime(1999) })
        expect(MockEventSource.instances).toHaveLength(2)
        act(() => { vi.advanceTimersByTime(1) })
        expect(MockEventSource.instances).toHaveLength(3)

        // Third failure → 4s delay
        const third = MockEventSource.instances[2]
        act(() => { third.onerror?.() })
        act(() => { vi.advanceTimersByTime(3999) })
        expect(MockEventSource.instances).toHaveLength(3)
        act(() => { vi.advanceTimersByTime(1) })
        expect(MockEventSource.instances).toHaveLength(4)
      } finally {
        vi.useRealTimers()
      }
    })

    it('caps backoff at 30s', () => {
      vi.useFakeTimers()
      try {
        renderHook(() => useSSE('C-001'))
        // Fire 8 consecutive errors with no successful open between them
        // — 2^7 = 128s would exceed the cap; should clamp to 30s.
        for (let i = 0; i < 8; i++) {
          const es = MockEventSource.instances[i]
          act(() => { es.onerror?.() })
          act(() => { vi.advanceTimersByTime(30_000) })
        }
        // After 8 errors there are 9 instances (initial + 8 retries).
        expect(MockEventSource.instances).toHaveLength(9)

        // Confirm the cap: the 9th instance's error should still schedule
        // a 30s (not 60s+) timer.
        const last = MockEventSource.instances[8]
        act(() => { last.onerror?.() })
        act(() => { vi.advanceTimersByTime(29_999) })
        expect(MockEventSource.instances).toHaveLength(9)
        act(() => { vi.advanceTimersByTime(1) })
        expect(MockEventSource.instances).toHaveLength(10)
      } finally {
        vi.useRealTimers()
      }
    })

    it('resets backoff after successful onopen', () => {
      vi.useFakeTimers()
      try {
        renderHook(() => useSSE('C-001'))
        // Two consecutive errors → backoff would be 1s, 2s.
        act(() => { MockEventSource.instances[0].onerror?.() })
        act(() => { vi.advanceTimersByTime(1000) })
        act(() => { MockEventSource.instances[1].onerror?.() })
        act(() => { vi.advanceTimersByTime(2000) })
        // The 3rd instance opens successfully — should reset clock.
        act(() => { MockEventSource.instances[2].open() })

        // Next failure should wait 1s (NOT 4s), proving the reset.
        act(() => { MockEventSource.instances[2].onerror?.() })
        act(() => { vi.advanceTimersByTime(999) })
        expect(MockEventSource.instances).toHaveLength(3)
        act(() => { vi.advanceTimersByTime(1) })
        expect(MockEventSource.instances).toHaveLength(4)
      } finally {
        vi.useRealTimers()
      }
    })

    it('forces immediate reconnect on visibilitychange when disconnected', () => {
      vi.useFakeTimers()
      try {
        renderHook(() => useSSE('C-001'))
        const first = MockEventSource.instances[0]
        // Error: scheduled to reconnect 1s later.
        act(() => { first.onerror?.() })
        // Tab becomes visible BEFORE the 1s timer fires → reconnect now.
        Object.defineProperty(document, 'visibilityState', {
          configurable: true, value: 'visible',
        })
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'))
        })
        // New EventSource constructed immediately; no need to advance time.
        expect(MockEventSource.instances).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not churn on visibilitychange when already connected', () => {
      renderHook(() => useSSE('C-001'))
      const first = MockEventSource.instances[0]
      // Simulate a healthy open connection: readyState OPEN.
      Object.defineProperty(first, 'readyState', { configurable: true, value: 1 })
      act(() => { first.open() })
      // Tab becomes visible: noop since we're already connected.
      Object.defineProperty(document, 'visibilityState', {
        configurable: true, value: 'visible',
      })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(MockEventSource.instances).toHaveLength(1)
    })

    it('forces a fresh EventSource when forceReconnect() bumps connectionEpoch', () => {
      // Simulates the "Reconnect" badge in the chat header: user clicks
      // the button → store action increments connectionEpoch → useSSE's
      // effect tears down the (possibly silently-dead) EventSource and
      // builds a new one. Without this affordance the user had to hard-
      // refresh the page, losing the cold cache for no real reason.
      const { rerender } = renderHook(() => useSSE('C-001'))
      expect(MockEventSource.instances).toHaveLength(1)
      const original = MockEventSource.instances[0]
      // Simulate a healthy open connection — readyState OPEN so the
      // visibility/online listeners would NOT reconnect (the manual
      // path must work regardless of whether the existing ES looks
      // alive).
      Object.defineProperty(original, 'readyState', { configurable: true, value: 1 })
      act(() => { original.open() })

      // User clicks the Reconnect badge:
      act(() => { useStore.getState().forceReconnect() })
      rerender()

      // A second EventSource was constructed.
      expect(MockEventSource.instances).toHaveLength(2)
      // The original one was closed during teardown.
      expect(original.close).toHaveBeenCalled()
    })

    it('forces immediate reconnect on online event when disconnected', () => {
      vi.useFakeTimers()
      try {
        renderHook(() => useSSE('C-001'))
        const first = MockEventSource.instances[0]
        act(() => { first.onerror?.() })
        // Network comes back before the 1s backoff fires.
        act(() => {
          window.dispatchEvent(new Event('online'))
        })
        expect(MockEventSource.instances).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
