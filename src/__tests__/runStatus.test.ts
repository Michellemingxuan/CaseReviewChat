import { describe, it, expect } from 'vitest'
import { runStatus } from '../components/OrchestrationFlowPanel/OrchestrationFlowPanel'
import type { AgentRun } from '../types'

// RC2 / issue #5: when the turn errors (e.g. report_agent fails / orchestrator
// synthesis error), a domain specialist with no error of its OWN must not be
// painted red "failed". It either completed (has a payload → done) or was
// interrupted (no payload → neutral), never falsely "failed" from turn status.

function run(payload?: unknown): AgentRun {
  return {
    call_id: 'c1',
    tool: 'modeling',
    ...(payload !== undefined ? { payload: payload as AgentRun['payload'] } : {}),
  }
}

describe('runStatus', () => {
  it('payloadless specialist on an ERRORED turn is neutral, not failed', () => {
    expect(runStatus(run(), 'error')).toBe('idle')
  })

  it('payloadless specialist on a DONE turn is neutral, not failed', () => {
    expect(runStatus(run(), 'done')).toBe('idle')
  })

  it('specialist with a non-error payload is done even when the turn errored', () => {
    expect(runStatus(run({ findings: 'ok' }), 'error')).toBe('done')
  })

  it("a specialist's OWN recoverable error is still marked failed", () => {
    expect(runStatus(run(), 'error', 'timeout: did not complete')).toBe('error')
  })

  it('payloadless specialist mid-stream (turn still streaming) is running', () => {
    expect(runStatus(run(), 'streaming')).toBe('running')
  })
})
