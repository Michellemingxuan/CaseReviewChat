import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartTypeIcon } from '../journey/ChartTypeIcon'

describe('ChartTypeIcon', () => {
  it.each([
    ['trend', 'Trend'],
    ['bar', 'Bar'],
    ['share', 'Share'],
    ['table', 'Table'],
    ['trend_dual', 'Dual trend'],
    ['trend_grid', 'Trend grid'],
  ])('labels %s as %s', (kind, label) => {
    render(<ChartTypeIcon kind={kind} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('names an unfamiliar kind rather than showing nothing', () => {
    // A kind the frontend does not know is still a figure; hiding it would
    // make the card look broken.
    render(<ChartTypeIcon kind="sankey_thing" />)
    expect(screen.getByText('sankey thing')).toBeTruthy()
  })

  it('falls back to a generic label when the kind is missing', () => {
    render(<ChartTypeIcon kind={null} />)
    expect(screen.getByText('Figure')).toBeTruthy()
  })
})
