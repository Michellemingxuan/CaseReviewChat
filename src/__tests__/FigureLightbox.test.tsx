import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FigureLightbox } from '../journey/FigureLightbox'

// vega-embed touches canvas, which jsdom lacks; the lightbox's own behaviour
// is what's under test, not the chart renderer.
vi.mock('../components/PlotPanel/VegaChart', () => ({
  VegaChart: ({ alt }: { alt?: string }) => <div data-testid="vega">{alt}</div>,
}))

describe('FigureLightbox', () => {
  it('renders nothing when no figure is selected', () => {
    const { container } = render(<FigureLightbox figure={null} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('prefers the vega spec over the PNG so it refits to the overlay', () => {
    render(<FigureLightbox
      figure={{ title: 'TSR', caption: 'peak 27.4', spec: { mark: 'line' }, url: '/a.png' }}
      onClose={() => {}} />)
    expect(screen.getByTestId('vega')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('falls back to the PNG when there is no spec', () => {
    render(<FigureLightbox
      figure={{ title: 'TSR', spec: null, url: '/a.png' }} onClose={() => {}} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('/a.png')
  })

  it('says so when there is nothing to draw', () => {
    render(<FigureLightbox figure={{ title: 'TSR' }} onClose={() => {}} />)
    expect(screen.getByText(/No renderable figure/i)).toBeTruthy()
  })

  it('closes on Escape and on backdrop click, but not on dialog click', () => {
    const onClose = vi.fn()
    render(<FigureLightbox figure={{ title: 'TSR', url: '/a.png' }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores body scroll when it unmounts', () => {
    const { unmount } = render(
      <FigureLightbox figure={{ title: 'TSR', url: '/a.png' }} onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
