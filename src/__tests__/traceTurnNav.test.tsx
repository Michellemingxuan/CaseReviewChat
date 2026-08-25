import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuditTracePanel } from '../components/AuditTracePanel/AuditTracePanel'
import { useStore } from '../store'
import type { Turn } from '../types'

/**
 * Paging the reasoning trace between turns.
 *
 * Regression: the journey shell rendered its "hide the trace" control as an
 * absolutely-positioned button at the panel's top-right — which is exactly
 * where the "next turn" arrow lives. The fold button won on z-index and ate
 * those clicks, so the trace could be paged backwards but never forwards.
 * The control now lives IN the flex header row, where it cannot overlap.
 */

const turn = (n: number): Turn => ({
  turn_id: `t${n}`,
  question: `question ${n}`,
  started_at: Date.now(),
  agent_runs: [],
  status: 'done',
} as Turn)

beforeEach(() => {
  useStore.setState({
    activeCase: 'A',
    threads: {},
    turns: { A: [turn(1), turn(2), turn(3)] },
    activeTurnId: { A: 't2' },
    unread: new Set(),
  })
})

describe('reasoning trace turn navigation', () => {
  it('pages forward as well as back', async () => {
    render(<AuditTracePanel caseId="A" onCollapse={() => {}} />)
    expect(screen.getByText('Turn 2 of 3')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '›' }))
    expect(useStore.getState().activeTurnId.A).toBe('t3')
  })

  it('pages back', async () => {
    render(<AuditTracePanel caseId="A" onCollapse={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '‹' }))
    expect(useStore.getState().activeTurnId.A).toBe('t1')
  })

  it('puts the fold control in the same row as the arrows, not on top of them', async () => {
    // jsdom has no layout, so overlap cannot be measured — but siblings in a
    // flex row cannot overlap, and that structure IS the fix.
    const { container } = render(<AuditTracePanel caseId="A" onCollapse={() => {}} />)
    const row = container.querySelector('[class*="headRow"]')!
    const labels = within(row as HTMLElement).getAllByRole('button')
      .map((b) => b.textContent?.trim())
    expect(labels).toContain('‹')
    expect(labels).toContain('›')
    expect(labels.some((l) => l?.includes('❭'))).toBe(true)
  })

  it('still offers the fold control when there are no turns to page', async () => {
    useStore.setState({ turns: { A: [] }, activeTurnId: {} })
    const onCollapse = vi.fn()
    render(<AuditTracePanel caseId="A" onCollapse={onCollapse} />)
    await userEvent.click(screen.getByRole('button', { name: /❭/ }))
    expect(onCollapse).toHaveBeenCalled()
  })

  it('renders no fold control for the classic shell, which passes none', () => {
    const { container } = render(<AuditTracePanel caseId="A" />)
    const row = container.querySelector('[class*="headRow"]')!
    const labels = within(row as HTMLElement).getAllByRole('button')
      .map((b) => b.textContent?.trim())
    expect(labels.some((l) => l?.includes('❭'))).toBe(false)
  })
})
