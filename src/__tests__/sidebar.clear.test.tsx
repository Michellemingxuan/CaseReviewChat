import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore } from '../store'

vi.mock('../api', () => ({ postRewind: vi.fn().mockResolvedValue(undefined) }))
import { postRewind } from '../api'
import { handleClearHistoryForActive } from '../components/Sidebar/Sidebar'

beforeEach(() => {
  useStore.setState({ activeCase: 'A', threads: { A: [], B: [] }, turns: {}, activeTurnId: {}, unread: new Set() })
  vi.clearAllMocks()
})

it('rewinds only the active case and clears only its thread', async () => {
  await handleClearHistoryForActive()
  expect(postRewind).toHaveBeenCalledTimes(1)
  expect(postRewind).toHaveBeenCalledWith('A', '')
})
