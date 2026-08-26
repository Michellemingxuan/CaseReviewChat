import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PinFigure } from '../journey/PinFigure'
import type { Pin } from '../types'

const pin = (over: Partial<Pin> = {}): Pin => ({
  pin_id: 'p1', kind: 'figure', text: 'Spend fell to 22', turn_id: 't1', turn_index: 3,
  source: 'Turn 3', specialist: 'spend_payments', topic: 'amount_trend',
  chart_url: '/api/cases/c/pinned-figures/a.png', section_key: null, created_at: 0,
  ...over,
})

describe('PinFigure', () => {
  it('renders the image when the file is there', () => {
    render(<PinFigure pin={pin()} />)
    expect(screen.getByRole('img', { name: 'Spend fell to 22' }).getAttribute('src'))
      .toBe('/api/cases/c/pinned-figures/a.png')
  })

  it('replaces a 404 with a stated fallback, not the broken-image glyph', () => {
    // A pin can outlive the turn whose chart it points at; painting the
    // browser's broken-image icon inside a report reads as a corrupted
    // document rather than a missing artifact.
    render(<PinFigure pin={pin()} />)
    fireEvent.error(screen.getByRole('img'))

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/no longer available/i)).toBeTruthy()
  })

  it('names the turn in the fallback so the cause is traceable', () => {
    render(<PinFigure pin={pin()} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText(/turn 3 may have been rewound/i)).toBeTruthy()
  })

  it('shows the fallback immediately when there is no url at all', () => {
    render(<PinFigure pin={pin({ chart_url: null })} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/no longer available/i)).toBeTruthy()
  })

  it('falls back to the topic for alt text when the pin has no claim', () => {
    render(<PinFigure pin={pin({ text: '' })} />)
    expect(screen.getByRole('img', { name: 'amount_trend' })).toBeTruthy()
  })
})
