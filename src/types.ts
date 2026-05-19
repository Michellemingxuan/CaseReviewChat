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

export type ChartInfo = {
  /** Stable per-(specialist, topic) within a turn — latest wins on the
   *  server side; the frontend just dedupes by this composite key when
   *  re-rendering. */
  specialist: string
  topic: string
  /** Server-relative URL the frontend can fetch directly (e.g.
   *  `/api/cases/<case>/charts/<file>.png`). Empty string for
   *  `kind: "table"` (no image rendered). */
  url: string
  /** One-sentence finding the chart visualizes. Shown as the button label
   *  / tooltip in the reasoning trace. */
  claim: string
  /** Upstream tool call that produced the data (audit info; may be empty). */
  source_call: string
  /** `trend` | `bar` | `share` | `trend_dual` | `trend_grid` | `table` —
   *  used for icon selection and to decide which renderer (Vega-Lite,
   *  static PNG, or HTML table) PlotPanel uses for the active tab. */
  kind: string
  /** Optional Vega-Lite v5 spec for downstream interactive renderers.
   *  Shapes by kind:
   *    - `trend` / `bar`: standard `mark`+`encoding` spec.
   *    - `share`: horizontal-bar spec.
   *    - `trend_dual`: layered spec with `resolve.scale.y == "independent"`.
   *    - `trend_grid`: `vconcat` of N single-series specs.
   *    - `table`: absent — see `numbers` / `x_field` / `y_fields` below.
   */
  vega_spec?: Record<string, unknown> | null
  /** `kind === "table"` payload extras. Each entry in `numbers` is one row;
   *  `x_field` is the leftmost column header; `y_fields` lists the rest of
   *  the columns in display order. Undefined for non-table charts. */
  numbers?: Array<Record<string, unknown>>
  x_field?: string
  y_fields?: string[]
}

/** Placeholder for a chart that's been requested by a specialist but whose
 *  rendered PNG hasn't arrived yet. The server emits a `chart_pending` SSE
 *  event the instant `make_chart` is called (after validation, before the
 *  matplotlib render); the actual `chart` event lands later at end-of-turn.
 *  Match pending → actual by (specialist, topic). */
export type PendingChart = {
  specialist: string
  topic: string
  kind: string
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
  /** Charts emitted via the `chart` SSE event for this turn — rendered
   *  in the reasoning-trace panel (NOT inline in the chat answer). */
  charts?: ChartInfo[]
  /** Charts the server announced via `chart_pending` but whose final
   *  `chart` event hasn't arrived yet. PlotPanel shows a "Working on the
   *  plot…" placeholder for each. Cleared per (specialist, topic) when
   *  the matching `chart` event lands. */
  pendingCharts?: PendingChart[]
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
  /** Bumped by `forceReconnect()` to make `useSSE` tear down and rebuild
   *  the EventSource. Lets the "Reconnecting" badge become a one-click
   *  recovery affordance instead of forcing the user to hard-refresh
   *  (which loses the live SSE the same way but ALSO wastes a full page
   *  load + cold cache). */
  connectionEpoch: number
  unread: Set<string>
  // actions — chat
  setCaseList: (list: CaseList) => void
  setActiveCase: (id: string) => void
  appendMessage: (caseId: string, msg: Message) => void
  rewindThread: (caseId: string, messageId: string) => string
  setSseStatus: (status: SseStatus) => void
  /** Force the SSE hook to drop its current EventSource and reconnect.
   *  Used by the manual "Reconnect" affordance in the chat header. */
  forceReconnect: () => void
  markUnread: (caseId: string) => void
  clearHistory: () => void
  // actions — turns / trace
  startTurn: (caseId: string, turn: Turn) => void
  patchTurn: (caseId: string, turnId: string, patch: Partial<Turn>) => void
  upsertAgentRun: (caseId: string, turnId: string, run: AgentRun) => void
  /** Append (or replace, dedup-by-(specialist, topic)) a chart on a turn.
   *  Also clears any matching `pendingCharts` entry so the placeholder
   *  hides as soon as the real chart arrives. */
  upsertChart: (caseId: string, turnId: string, chart: ChartInfo) => void
  /** Add a pending-chart placeholder. Dedup-by-(specialist, topic); a
   *  duplicate `chart_pending` event for the same key is a no-op. */
  upsertPendingChart: (caseId: string, turnId: string, pending: PendingChart) => void
  setActiveTurn: (caseId: string, turnId: string | null) => void
}
