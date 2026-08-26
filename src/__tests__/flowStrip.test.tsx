import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlowStrip } from '../journey/FlowStrip'
import { useStore } from '../store'
import type { Turn } from '../types'

const turn = (over: Partial<Turn> = {}): Turn => ({
  turn_id: 't1', question: 'q', started_at: 0, status: 'done',
  team_plan: [], agent_runs: [], ...over,
} as Turn)

beforeEach(() => {
  useStore.setState({ turns: {}, activeTurnId: {}, threads: {}, unread: new Set() })
})

describe('FlowStrip', () => {
  it('keeps the classic fork: report and team as separate parallel branches', () => {
    // The shape is the point — two branches side by side is what shows they
    // ran in parallel and rejoined. A flat list loses exactly that.
    useStore.setState({
      turns: { A: [turn({
        team_plan: [
          { call_id: 'r', tool: 'report_agent', sub_question: 'x' },
          { call_id: 't', tool: 'modeling', sub_question: 'y' },
        ],
        agent_runs: [{ call_id: 'r', tool: 'report_agent', payload: {} }],
      })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)

    expect(screen.getByText('Report')).toBeTruthy()
    expect(screen.getByText('Specialists')).toBeTruthy()
    expect(screen.getByText('screen')).toBeTruthy()
    expect(screen.getByText('team')).toBeTruthy()   // was 'plan'
    expect(screen.getByText('synthesis')).toBeTruthy()
  })

  it('shows each agent and whether it has come back', () => {
    useStore.setState({
      turns: { A: [turn({ status: 'streaming',
        question_check: { passed: true } as never,
        team_plan: [
          { call_id: 'c1', tool: 'spend_payments', sub_question: 'x' },
          { call_id: 'c2', tool: 'modeling', sub_question: 'y' },
        ],
        agent_runs: [
          { call_id: 'c1', tool: 'spend_payments', duration_ms: 4860, payload: {} },
          { call_id: 'c2', tool: 'modeling' },   // no payload = still running
        ] })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)

    expect(screen.getByText('spend_payments')).toBeTruthy()
    expect(screen.getByText('4.9s')).toBeTruthy()
    // The header no longer carries an agent count; the branch labels do.
    expect(screen.getByText('2')).toBeTruthy()   // Team branch count
  })

  it('omits sub-questions — that is the whole point of this strip', () => {
    // The classic panel renders them in full; they are the densest text in the
    // app and unreadable in a third of a column. The trace above still has them.
    useStore.setState({
      turns: { A: [turn({
        team_plan: [{ call_id: 'c1', tool: 'modeling',
          sub_question: 'bound the reaction window by each metric own threshold' }],
        agent_runs: [{ call_id: 'c1', tool: 'modeling', payload: {} }] })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)
    expect(screen.queryByText(/bound the reaction window/)).toBeNull()
  })

  it('marks a specialist the orchestrator absorbed an error from', () => {
    useStore.setState({
      turns: { A: [turn({
        team_plan: [{ call_id: 'c1', tool: 'modeling', sub_question: 'x' }],
        agent_runs: [{ call_id: 'c1', tool: 'modeling', payload: {} }],
        errorsBySpecialist: { modeling: 'max_turns_exceeded' },
      })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)
    expect(screen.getByText('failed')).toBeTruthy()
  })

  it('grows with the turn: no branches before anything is dispatched', () => {
    useStore.setState({
      turns: { A: [turn({ status: 'streaming', question_check: { passed: true } as never,
                          team_plan: [], agent_runs: [] })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)
    expect(screen.getByText('screen')).toBeTruthy()
    expect(screen.getByText('team')).toBeTruthy()
    expect(screen.queryByText('Report')).toBeNull()
    expect(screen.queryByText('Specialists')).toBeNull()
    expect(screen.queryByText('synthesis')).toBeNull()
  })

  it('shows ONLY screen for a question the screen rejected', () => {
    // "what to eat" never reaches the orchestrator, so drawing team, both
    // branches and synthesis would show a pipeline that was never going to run.
    useStore.setState({
      turns: { A: [turn({
        status: 'done',
        question_check: { passed: false, in_scope: false } as never,
        team_plan: [], agent_runs: [],
      })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)

    expect(screen.getByText('screen')).toBeTruthy()
    expect(screen.getByText('out of scope')).toBeTruthy()
    expect(screen.queryByText('team')).toBeNull()
    expect(screen.queryByText('Report')).toBeNull()
    expect(screen.queryByText('Specialists')).toBeNull()
    expect(screen.queryByText('synthesis')).toBeNull()
  })

  it('distinguishes rejected-in-scope from out-of-scope', () => {
    useStore.setState({
      turns: { A: [turn({ status: 'done',
        question_check: { passed: false, in_scope: true } as never })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)
    expect(screen.getByText('not accepted')).toBeTruthy()
  })

  it('still draws downstream work if it somehow arrives before the check', () => {
    // Guard against event-ordering anomalies: real activity must never be
    // hidden behind a flag that has not landed yet.
    useStore.setState({
      turns: { A: [turn({ status: 'streaming', question_check: undefined,
        team_plan: [{ call_id: 'c1', tool: 'modeling', sub_question: 'x' }],
        agent_runs: [] })] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)
    expect(screen.getByText('Specialists')).toBeTruthy()
  })

  it('follows the turn the reviewer selected, not just the newest', () => {
    useStore.setState({
      turns: { A: [
        turn({ turn_id: 't1',
          team_plan: [{ call_id: 'a', tool: 'bureau', sub_question: 'x' }],
          agent_runs: [{ call_id: 'a', tool: 'bureau', payload: {} }] }),
        turn({ turn_id: 't2',
          team_plan: [{ call_id: 'b', tool: 'crossbu', sub_question: 'y' }],
          agent_runs: [{ call_id: 'b', tool: 'crossbu', payload: {} }] }),
      ] },
      activeTurnId: { A: 't1' },
    })
    render(<FlowStrip caseId="A" />)
    expect(screen.getByText('bureau')).toBeTruthy()
    expect(screen.queryByText('crossbu')).toBeNull()
  })
})
