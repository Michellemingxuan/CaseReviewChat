export type Message = {
  id: string
  role: 'agent' | 'reviewer'
  text: string
  timestamp: number
  turn_id?: string
}

export type SseStatus = 'connected' | 'disconnected'

export type CaseList = {
  consumer: string[]
  commercial: string[]
}

// ── Trace types — match server.py SSE event payloads ──────────────────────

export type Outcome = 'ok' | 'screen_rejected' | 'out_of_scope' | 'orchestrator_error'

export type QuestionCheck = {
  passed: boolean
  reason: string
  redacted_question: string
  in_scope: boolean
  outcome: Outcome
}

export type ToolCall = {
  call_id: string
  tool: string
  sub_question: string
}

// Matches AgenticSys_v2/models/types.py:ReportDraft
export type ReportDraftPayload = {
  coverage: 'explicit' | 'implicit' | 'not_mentioned'
  answer: string
  evidence_excerpts: string[]
  files_consulted: string[]
}

// Matches AgenticSys_v2/models/types.py:SpecialistOutput
export type SpecialistPayload = {
  domain?: string
  question?: string
  mode?: string
  findings: string
  evidence: string[]
  implications: string[]
  data_gaps: string[]
  raw_data?: Record<string, unknown>
}

// Matches AgenticSys_v2/models/types.py:ReviewReport
export type ReviewReportPayload = {
  resolved: unknown[]
  open_conflicts: unknown[]
  cross_domain_insights: string[]
  data_requests_made?: unknown[]
}

export type AgentRunPayload =
  | ReportDraftPayload
  | SpecialistPayload
  | ReviewReportPayload
  | Record<string, unknown>

export type AgentRun = {
  call_id: string
  tool: string
  sub_question?: string
  started_at?: number
  duration_ms?: number
  payload?: AgentRunPayload
}

export type FinalSynthesis = {
  answer: string
  flags: string[]
  timeline: unknown[]
  data_pull_request?: unknown
}

export type Turn = {
  turn_id: string
  question: string
  started_at: number
  ended_at?: number
  duration_ms?: number
  question_check?: QuestionCheck
  team_plan?: ToolCall[]
  agent_runs: AgentRun[]
  final?: FinalSynthesis
  outcome?: Outcome
  status: 'streaming' | 'done' | 'error'
  error?: string
}

export type StoreState = {
  caseList: CaseList
  activeCase: string | null
  threads: Record<string, Message[]>
  turns: Record<string, Turn[]>
  activeTurnId: Record<string, string | null>
  sseStatus: SseStatus
  unread: Set<string>
  // actions — chat
  setCaseList: (list: CaseList) => void
  setActiveCase: (id: string) => void
  appendMessage: (caseId: string, msg: Message) => void
  rewindThread: (caseId: string, messageId: string) => string
  setSseStatus: (status: SseStatus) => void
  markUnread: (caseId: string) => void
  clearHistory: () => void
  // actions — turns / trace
  startTurn: (caseId: string, turn: Turn) => void
  patchTurn: (caseId: string, turnId: string, patch: Partial<Turn>) => void
  upsertAgentRun: (caseId: string, turnId: string, run: AgentRun) => void
  setActiveTurn: (caseId: string, turnId: string | null) => void
}
