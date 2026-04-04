import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCaseList, postMessage, postRewind } from '../api'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('fetchCaseList', () => {
  it('returns array of case IDs on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['C-001', 'C-002'],
    } as Response)

    const result = await fetchCaseList()
    expect(result).toEqual(['C-001', 'C-002'])
    expect(fetch).toHaveBeenCalledWith('/api/cases')
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    await expect(fetchCaseList()).rejects.toThrow('fetchCaseList failed: 500')
  })
})

describe('postMessage', () => {
  it('posts text to correct endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    await postMessage('C-001', 'hello')
    expect(fetch).toHaveBeenCalledWith('/api/cases/C-001/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
  })
})

describe('postRewind', () => {
  it('posts messageId to correct endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    await postRewind('C-001', 'm1')
    expect(fetch).toHaveBeenCalledWith('/api/cases/C-001/rewind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'm1' }),
    })
  })
})
