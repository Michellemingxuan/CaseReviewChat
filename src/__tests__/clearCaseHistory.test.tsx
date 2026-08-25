import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api', () => ({
  postRewind: vi.fn().mockResolvedValue(undefined),
  fetchHistory: vi.fn().mockResolvedValue([]),
  fetchPins: vi.fn().mockResolvedValue([]),
  openSSE: vi.fn(() => ({ close: vi.fn(), addEventListener: vi.fn() })),
}))
import { fetchHistory, postRewind } from '../api'
import { clearCaseHistory } from '../lib/caseHistory'
import { useStore } from '../store'

beforeEach(() => {
  // jsdom implements neither; the assistant scrolls to the newest turn on
  // every render. Same stub as ChatPanel.test.tsx.
  Element.prototype.scrollIntoView = vi.fn()
  useStore.setState({
    activeCase: 'A',
    threads: { A: [{ id: 'm1', role: 'reviewer', text: 'q' }], B: [{ id: 'm2', role: 'reviewer', text: 'q2' }] },
    turns: { A: [], B: [] }, activeTurnId: {}, unread: new Set(['A']),
  })
  vi.clearAllMocks()
})

describe('clearCaseHistory', () => {
  it('clears the server cache as well as the local thread', async () => {
    // Both halves are required: without the rewind, re-asking a question
    // replays its cached answer and the case is not actually clear.
    await clearCaseHistory('A')
    expect(postRewind).toHaveBeenCalledWith('A', '')
    expect(useStore.getState().threads.A).toBeUndefined()
  })

  it('touches only the named case', async () => {
    await clearCaseHistory('A')
    expect(useStore.getState().threads.B).toHaveLength(1)
  })

  it('is a no-op with no case selected', async () => {
    await clearCaseHistory(null)
    expect(postRewind).not.toHaveBeenCalled()
  })

  it('still clears locally when the server call fails', async () => {
    // Leaving the reviewer staring at a thread they asked to delete is worse
    // than a stale server cache.
    vi.mocked(postRewind).mockRejectedValueOnce(new Error('offline'))
    await clearCaseHistory('A')
    expect(useStore.getState().threads.A).toBeUndefined()
  })
})

describe('the Clear control', () => {
  it('requires a second click before destroying anything', async () => {
    const { AssistantPanel } = await import('../journey/chat/AssistantPanel')
    const thread = [
      { id: 'q1', role: 'reviewer' as const, text: 'a question', turn_id: 't1' },
      { id: 'a1', role: 'agent' as const, text: 'an answer', turn_id: 't1' },
    ]
    // The panel fetches /history on mount, and `setCaseHistory` now drops
    // local messages the server omits unless their turn is still streaming.
    // So the server has to know about this turn, or the thread is emptied
    // before anything can be clicked.
    vi.mocked(fetchHistory).mockResolvedValue(thread)
    useStore.setState({
      activeCase: 'A',
      threads: { A: thread }, turns: { A: [] }, activeTurnId: {}, unread: new Set(),
    })
    render(<AssistantPanel caseId="A" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }))
    expect(postRewind).not.toHaveBeenCalled()      // armed, not fired

    await userEvent.click(screen.getByText('Cancel'))
    expect(postRewind).not.toHaveBeenCalled()      // and cancellable
  })
})
