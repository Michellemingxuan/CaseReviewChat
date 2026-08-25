import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Rehydrating a turn that was in flight when the server died.
 *
 * Anchored to a real incident: after redeploying, a colleague's browser showed
 * questions stuck on "Working on it…" that nobody else could see and that the
 * new backend had no record of. The turns were mid-flight against the OLD
 * process; it was gone, so no answer could ever arrive, and the rehydrate path
 * deliberately does not cancel streaming turns — an accidental refresh must
 * not kill live work. Nothing resolved them, ever.
 *
 * The store's own note called that edge "acceptable and rare". A redeploy
 * makes it neither.
 */

const KEY = 'case-review-threads-v7'

const persisted = (turns: unknown) => JSON.stringify({
  state: { caseList: { consumer: [], commercial: [] }, activeCase: 'A',
           threads: {}, turns, activeTurnId: {}, unread: [] },
  version: 0,
})

const turn = (over: Record<string, unknown>) => ({
  turn_id: 't1', question: 'q', agent_runs: [], status: 'streaming', ...over,
})

/** Load the store fresh so its persist middleware reads localStorage.
 *  `resetModules` is what makes the re-import actually re-run the module —
 *  a query-string cache-bust does not survive the bundler's transform. */
async function rehydrate() {
  vi.resetModules()
  const mod = await import('../store')
  return mod.useStore.getState()
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('stale streaming turns on rehydrate', () => {
  it('leaves a RECENT streaming turn alone', async () => {
    // The accidental-hard-refresh case: the server turn is still running and
    // SSE replay will finish it. Cancelling here would destroy live work.
    localStorage.setItem(KEY, persisted({
      A: [turn({ started_at: Date.now() - 5_000 })],
    }))
    const st = await rehydrate()
    expect(st.turns.A[0].status).toBe('streaming')
    expect(st.turns.A[0].errorKind).toBeUndefined()
  })

  it('marks an OLD streaming turn interrupted', async () => {
    // Older than the server's own turn budget, so its process is provably gone.
    localStorage.setItem(KEY, persisted({
      A: [turn({ started_at: Date.now() - 30 * 60 * 1000 })],
    }))
    const st = await rehydrate()
    expect(st.turns.A[0].status).toBe('error')
    expect(st.turns.A[0].errorKind).toBe('interrupted')
    expect(st.turns.A[0].error).toMatch(/server restarted/i)
  })

  it('treats a missing started_at as stale rather than live', async () => {
    // The safe direction: the alternative is a ghost that never clears.
    localStorage.setItem(KEY, persisted({ A: [turn({})] }))
    const st = await rehydrate()
    expect(st.turns.A[0].status).toBe('error')
  })

  it('does not touch turns that already finished', async () => {
    localStorage.setItem(KEY, persisted({
      A: [turn({ turn_id: 'done1', status: 'done', started_at: 0 }),
          turn({ turn_id: 'err1', status: 'error', started_at: 0,
                 errorKind: 'transport' })],
    }))
    const st = await rehydrate()
    expect(st.turns.A[0].status).toBe('done')
    expect(st.turns.A[1].errorKind).toBe('transport')   // not overwritten
  })

  it('sweeps every case, not just the active one', async () => {
    localStorage.setItem(KEY, persisted({
      A: [turn({ started_at: Date.now() - 60 * 60 * 1000 })],
      B: [turn({ turn_id: 't2', started_at: Date.now() - 60 * 60 * 1000 })],
    }))
    const st = await rehydrate()
    expect(st.turns.A[0].status).toBe('error')
    expect(st.turns.B[0].status).toBe('error')
  })

  it('ignores state written under the previous key', async () => {
    // The v6 -> v7 bump is what clears ghosts persisted before this check
    // existed; those turns are never read again.
    localStorage.setItem('case-review-threads-v6', persisted({
      A: [turn({ started_at: 0 })],
    }))
    const st = await rehydrate()
    expect(st.turns.A).toBeUndefined()
  })
})
