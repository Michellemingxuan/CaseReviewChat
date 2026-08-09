import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStore } from '../store'

vi.mock('../api', () => ({
  fetchHistory: vi.fn().mockResolvedValue([
    { id: 'hist:t1:agent', role: 'agent', text: 'A1', timestamp: 0, turn_id: 't1' },
  ]),
}))
import { fetchHistory } from '../api'
import { useCaseHistory } from '../hooks/useCaseHistory'

beforeEach(() => {
  useStore.setState({ threads: {}, turns: {}, activeTurnId: {}, unread: new Set() })
  vi.clearAllMocks()
})

it('loads history into the thread on case open', async () => {
  renderHook(() => useCaseHistory('A'))
  await waitFor(() => expect(fetchHistory).toHaveBeenCalledWith('A'))
  await waitFor(() => expect(useStore.getState().threads.A).toHaveLength(1))
})

it('is a no-op when caseId is null', () => {
  renderHook(() => useCaseHistory(null))
  expect(fetchHistory).not.toHaveBeenCalled()
})
