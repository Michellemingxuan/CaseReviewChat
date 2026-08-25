import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PinProvenance } from '../journey/PinProvenance'
import type { Pin } from '../types'

const pin = (over: Partial<Pin> = {}): Pin => ({
  pin_id: 'p1', kind: 'figure', text: '', turn_id: 't1', turn_index: 3,
  source: 'Turn 3 · modeling', specialist: 'modeling', topic: 'tsr',
  chart_url: null, section_key: null, created_at: 0, ...over,
})

describe('PinProvenance', () => {
  it('leads with the question, not the turn number', () => {
    // Turn numbers are positional: rewinding an earlier turn renumbers the
    // rest, so a pin captured as "Turn 3" starts pointing at a different one.
    render(<PinProvenance pin={pin({ question: 'how did TSR react?' })} />)
    expect(screen.getByText(/how did TSR react\?/)).toBeTruthy()
    expect(screen.queryByText(/Turn 3/)).toBeNull()
  })

  it('falls back to the source when there is no question', () => {
    // Report pins carry a section, not a question.
    render(<PinProvenance pin={pin({ question: null, source: 'Report · Bureau' })} />)
    expect(screen.getByText('Report · Bureau')).toBeTruthy()
  })

  it('marks a retracted pin', () => {
    render(<PinProvenance pin={pin({ question: 'q', retracted: true })} />)
    expect(screen.getByText('retracted')).toBeTruthy()
  })

  it('says nothing about retraction for a live pin', () => {
    render(<PinProvenance pin={pin({ question: 'q', retracted: false })} />)
    expect(screen.queryByText('retracted')).toBeNull()
  })

  it('never renders an empty label', () => {
    render(<PinProvenance pin={pin({ question: '   ', source: '' })} />)
    expect(screen.getByText('unknown source')).toBeTruthy()
  })
})
