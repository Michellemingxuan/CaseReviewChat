import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaseReportPanel } from '../journey/CaseReportPanel'
import type { CaseReport } from '../types'

const REPORT: CaseReport = {
  case_id: '366132845011',
  updated_at: '2025-10-02',
  sections: [
    { key: 'executive_summary', label: 'Exec Summary', filename: 'executive_summary_exp_0.md',
      markdown: '## 1. Why and how the default occurred?\n\n- Exposure management',
      figures: [] },
    { key: 'bureau', label: 'Bureau', filename: null, markdown: null, figures: [] },
    { key: 'strategy', label: 'Strategy', filename: 'strategy_0.md',
      markdown: '| Product Type | Date |\n|---|---|\n| OPEN | 2024-05-28 |',
      figures: [{
        pin_id: 'p1', kind: 'figure', text: 'Spend fell to 22 by 2025-07',
        turn_id: 't1', turn_index: 1, source: 'Turn 1 · spend_payments',
        specialist: 'spend_payments', topic: 'amount_trend',
        chart_url: '/api/cases/x/charts/a.png', section_key: 'strategy',
        created_at: 0,
      }] },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => REPORT })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('CaseReportPanel', () => {
  it('renders one chip per section, in server order', async () => {
    render(<CaseReportPanel caseId="366132845011" />)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Exec Summary', 'Bureau', 'Strategy'])
  })

  it('opens the first section that has content', async () => {
    render(<CaseReportPanel caseId="366132845011" />)
    expect(await screen.findByText(/Why and how the default occurred/)).toBeTruthy()
  })

  it('keeps a chip for a section with no file, and says it is absent', async () => {
    render(<CaseReportPanel caseId="366132845011" />)
    const bureau = await screen.findByRole('tab', { name: 'Bureau' })
    await userEvent.click(bureau)
    // The absence is stated rather than shown as an empty pane.
    expect(await screen.findByText(/No/)).toBeTruthy()
    expect(screen.getByText('Bureau', { selector: 'b' })).toBeTruthy()
  })

  it('renders a GFM pipe table as a real table', async () => {
    render(<CaseReportPanel caseId="366132845011" />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Strategy' }))
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    expect(screen.getByRole('columnheader', { name: 'Product Type' })).toBeTruthy()
  })

  it('wraps every table in its own scroller so wide ones are not clipped', async () => {
    // `strategy_0.md` is nine columns wide. The panel clips its overflow, so
    // an unwrapped table loses its right-hand columns outright — including
    // the limit figures the section exists to show.
    render(<CaseReportPanel caseId="366132845011" />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Strategy' }))
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    const wrapper = screen.getByRole('table').parentElement
    expect(wrapper?.tagName).toBe('DIV')
    expect(wrapper?.className).toMatch(/tableScroll/)
  })

  it('surfaces a failed fetch instead of showing an empty report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    render(<CaseReportPanel caseId="nope" />)
    expect(await screen.findByText(/Could not load the report/)).toBeTruthy()
  })

  it('renders figures inserted into a section, marked off from the report', async () => {
    // The boundary matters: an auditor must be able to tell which marks on
    // the page came from the curated report and which from the review.
    render(<CaseReportPanel caseId="366132845011" />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Strategy' }))

    const fig = await screen.findByRole('img', { name: 'Spend fell to 22 by 2025-07' })
    expect(fig.getAttribute('src')).toBe('/api/cases/x/charts/a.png')
    expect(screen.getByText(/Inserted figures/i)).toBeTruthy()
    expect(screen.getByText('Turn 1 · spend_payments')).toBeTruthy()
  })

  it('shows no inserted-figures block when a section has none', async () => {
    render(<CaseReportPanel caseId="366132845011" />)
    await screen.findByText(/Why and how the default occurred/)
    expect(screen.queryByText(/Inserted figures/i)).toBeNull()
  })
})
