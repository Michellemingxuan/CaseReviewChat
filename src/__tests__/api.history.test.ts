import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchHistory } from '../api'
import type { Message } from '../types'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('fetchHistory', () => {
  it('returns messages array on success', async () => {
    const messages: Message[] = [
      { id: 'm1', role: 'reviewer', text: 'hi', timestamp: 1 },
      { id: 'm2', role: 'agent', text: 'hello', timestamp: 2 },
    ]
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages }),
    } as Response)

    const result = await fetchHistory('C-001')
    expect(result).toEqual(messages)
    expect(fetch).toHaveBeenCalledWith('/api/cases/C-001/history')
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    await expect(fetchHistory('C-001')).rejects.toThrow('fetchHistory failed: 404')
  })
})
