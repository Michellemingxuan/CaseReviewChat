import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatPanel } from '../components/ChatPanel/ChatPanel'
import { useStore } from '../store'
import type { Message, Turn } from '../types'

// Minimal EventSource stub so useSSE() can mount without a real connection.
class MockEventSource {
  url: string
  readyState = 1
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  close = vi.fn()
  constructor(url: string) { this.url = url }
  addEventListener() {}
  removeEventListener() {}
}

const reviewerMsg = (text: string): Message => ({
  id: 'r1', role: 'reviewer', text, timestamp: 1,
})
const agentMsg = (text: string): Message => ({
  id: 'a1', role: 'agent', text, timestamp: 2, turn_id: 't1',
})
const streamingTurn = (): Turn => ({
  turn_id: 't1', question: 'why declined?', started_at: 1,
  agent_runs: [], status: 'streaming',
})

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource)
  // jsdom doesn't implement scrollIntoView; MessageList calls it on every render.
  Element.prototype.scrollIntoView = vi.fn()
  useStore.setState({
    caseList: { consumer: [], commercial: [] },
    activeCase: null, threads: {}, turns: {}, activeTurnId: {},
    sseStatus: 'connected', unread: new Set(),
  })
  localStorage.clear()
})

describe('ChatPanel typing indicator', () => {
  it('shows the "thinking" indicator after a hard-refresh while a turn is still streaming', () => {
    // Post-refresh state: the streaming turn is restored from the store, the
    // reviewer's question is in the thread, but the transient local
    // `showTyping` flag is false (fresh React mount). The indicator must still
    // appear — it has to be driven by the store's streaming status, not only
    // the local flag. (Before the fix it vanished until the final answer.)
    useStore.setState({
      activeCase: 'C-1',
      threads: { 'C-1': [reviewerMsg('why declined?')] },
      turns: { 'C-1': [streamingTurn()] },
      activeTurnId: { 'C-1': 't1' },
    })
    render(<ChatPanel />)
    // The typing row carries an "Agent" label. The only message is a Reviewer
    // bubble (labelled "Reviewer"), so an "Agent" label present ⇒ indicator shown.
    expect(screen.queryByText('Agent')).not.toBeNull()
  })

  it('does NOT show a dangling indicator once the agent answer has arrived (pre-turn_done)', () => {
    // The turn is still 'streaming' (turn_done hasn't landed) but the agent's
    // answer is already in the thread. The indicator must hide the instant the
    // answer shows — not dangle below it. The only "Agent" label allowed here
    // is the answer bubble's own label.
    useStore.setState({
      activeCase: 'C-1',
      threads: { 'C-1': [reviewerMsg('why declined?'), agentMsg('because X')] },
      turns: { 'C-1': [streamingTurn()] },
      activeTurnId: { 'C-1': 't1' },
    })
    render(<ChatPanel />)
    expect(screen.getAllByText('Agent')).toHaveLength(1) // bubble only, no typing row
  })
})
