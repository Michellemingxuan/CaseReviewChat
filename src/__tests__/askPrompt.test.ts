import { describe, it, expect } from 'vitest'
import { buildAskPrompt } from '../journey/CaseReportPanel'

describe('buildAskPrompt', () => {
  it('quotes a single bullet verbatim and names its section', () => {
    // Verbatim so the specialists can trace the claim back to its source
    // instead of re-deriving it, and so the transcript records what was asked.
    const q = buildAskPrompt(['External revolving utilization held at 92-93%'], 'Bureau')
    expect(q).toContain('"External revolving utilization held at 92-93%"')
    expect(q).toContain('Bureau report')
  })

  it('lists several selections rather than running them together', () => {
    const q = buildAskPrompt(['first claim', 'second claim'], 'Modeling')
    expect(q).toContain('- "first claim"')
    expect(q).toContain('- "second claim"')
    expect(q).toContain('For each')
  })
})
