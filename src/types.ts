export type Message = {
  id: string
  role: 'agent' | 'reviewer'
  text: string
  timestamp?: number
  turn_id?: string
}

export type SseStatus = 'connected' | 'disconnected'

export type CaseList = {
  consumer: string[]
  commercial: string[]
}

export type HistoryResponse = {
  messages: Message[]
}

// ── Trace types — match server.py SSE event payloads ──────────────────────

export type Outcome =
  | 'ok'
  | 'screen_rejected'
  | 'out_of_scope'
  | 'orchestrator_error'
  | 'aborted'
  | 'screen_timeout'
  | 'timeout'
  | 'queue_timeout'

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
  // Server-derived provenance, added as payload FIELDS by
  // AgenticSys_v2/agent_factories/agent_tools/agent_tool.py:_annotate_payload —
  // not part of the SpecialistOutput schema the model fills in.
  //
  // `scope` is `table: window` pairs for the whole run, e.g.
  // "spends: all dates; model_scores_transaction: 2025-05-01..2025-05-31".
  // It is what lets a reviewer catch a correct number measured over the wrong
  // set, and "all dates" is the load-bearing half: an unconstrained table
  // answering a windowed question is the error it exists to expose.
  scope?: string
  // Per-call detail behind the same numbers (table, column, op, every filter).
  measured_over?: string[]
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
  /** ChartInfo.kind — drives the card's type glyph. */
  chart_kind?: string | null
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
  /** When the error is structured (`error` SSE event with a `kind`
   *  field), this carries the kind so the orchestration-flow panel can
   *  distinguish, e.g., "interrupted" (user pressed Stop) from a hard
   *  LLM error. Today the only kind emitted is `'interrupted'`; other
   *  errors leave this undefined. */
  errorKind?: string
  /** Per-specialist recoverable errors (max_turns_exceeded, timeout,
   *  transport, etc.) that the orchestrator absorbed without aborting
   *  the whole turn. Keyed by specialist name (e.g. "modeling" →
   *  "max_turns_exceeded: hit the 15-turn budget…"). The
   *  OrchestrationFlowPanel renders these next to the matching agent
   *  node so the reviewer sees WHICH specialist failed and why,
   *  instead of the prior behavior where recoverable errors were
   *  silently dropped on the floor. */
  errorsBySpecialist?: Record<string, string>
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
  rewindThread: (caseId: string, messageId: string) => { text: string; removedTurnIds: string[] }
  setSseStatus: (status: SseStatus) => void
  /** Force the SSE hook to drop its current EventSource and reconnect.
   *  Used by the manual "Reconnect" affordance in the chat header. */
  forceReconnect: () => void
  markUnread: (caseId: string) => void
  clearHistory: () => void
  /** Clears only `threads[caseId]`, `turns[caseId]`, `activeTurnId[caseId]`,
   *  and removes `caseId` from `unread` — leaves other cases untouched. */
  clearCaseHistory: (caseId: string) => void
  /** Replaces `threads[caseId]` wholesale with server-authoritative history
   *  (e.g. on session resume), rather than appending. */
  setCaseHistory: (caseId: string, messages: Message[]) => void
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
  /** Drop a placeholder that will NEVER be filled (`chart_cancelled`).
   *
   *  `chart_pending` fires per specialist DURING the turn, but the real
   *  `chart` events are emitted at END of turn, after the server dedups
   *  identical figures across specialists. Anything dedup drops has already
   *  had its placeholder announced, and no `chart` event is ever coming — so
   *  without this the card spins forever beside the real one, which reads as
   *  "two specialists drew the same plot". The client cannot detect it alone;
   *  only the server knows what it chose not to emit. */
  removePendingChart: (
    caseId: string,
    turnId: string,
    key: { specialist: string; topic: string },
  ) => void
  setActiveTurn: (caseId: string, turnId: string | null) => void
}

// ── Case report (journey UI) ──────────────────────────────────────────────
// Mirrors AgenticSys_v2/server.py:get_report, which builds these from
// tools/fs_tools.py:list_report_sections.

export type ReportSection = {
  /** Domain prefix, e.g. `executive_summary`. Stable across `_exp_N` bumps. */
  key: string
  /** Reviewer-facing tab label, e.g. "Exec Summary". */
  label: string
  /** Source file on disk, or null when this case has no such report. */
  filename: string | null
  /** Section body. Null means the section is absent — render it as
   *  unavailable rather than hiding the tab, so a missing report is
   *  visible to the reviewer instead of silently narrowing the strip. */
  markdown: string | null
  /** Figures the reviewer inserted into this section. Kept alongside the
   *  markdown rather than spliced into it — the markdown is the report
   *  agent's source text, and rewriting it would change what the agent
   *  reads on the next turn. */
  figures: Pin[]
}

export type CaseReport = {
  case_id: string
  /** Newest file mtime across the sections, `YYYY-MM-DD`, or null.
   *  NOT a generation date — the reports carry no stamp of their own and
   *  a sync/copy rewrites mtime. Shown as "Updated", never "Generated". */
  updated_at: string | null
  sections: ReportSection[]
}

// ── Pins / opportunities ──────────────────────────────────────────────────
// Mirrors AgenticSys_v2/datalayer/pin_store.py.

export type PinKind = 'insight' | 'figure'

export type Pin = {
  pin_id: string
  kind: PinKind
  /** The claim, for an insight pin. Empty for figures. */
  text: string
  // Provenance — a pin the reviewer cannot trace back to its turn or report
  // section is an unsourced assertion, which is the opposite of the point.
  turn_id: string | null
  turn_index: number | null
  /** Human-readable origin, e.g. "spending & payment specialist" or
   *  "Report · Exec Sum". */
  source: string
  // figure pins only
  specialist: string | null
  topic: string | null
  chart_url: string | null
  /** Vega-Lite spec captured at pin time. The durable copy of the figure —
   *  it carries its data inline, so it survives the chart PNG being deleted
   *  (rewind does that). Preferred over `chart_url` when rendering. */
  vega_spec?: Record<string, unknown> | null
  /** ChartInfo.kind — drives the card's type glyph. */
  chart_kind?: string | null
  /** Report section this pin has been inserted into, or null. */
  section_key: string | null
  created_at: number
}

export type Opportunity = {
  opp_id: string
  title: string
  body: string
  /** Pins this was synthesised from — backs the "from 2 pins" chip. */
  pin_ids: string[]
  created_at: number
}

// ── Synthesis / overview ──────────────────────────────────────────────────

export type SynthesisMode = 'story' | 'opportunities'

export type ProposedOpportunity = { title: string; rationale: string }

export type PinSynthesis = {
  mode: SynthesisMode
  /** Filled in `story` mode, empty in `opportunities` mode. */
  story: string
  opportunities: ProposedOpportunity[]
  /** What the pins do NOT establish. Always rendered — a synthesis a
   *  reviewer has to defend downstream is worse without its own caveats. */
  not_settled: string[]
  pin_ids: string[]
}

export type CaseOverviewRow = {
  case_id: string
  /** Newest report-file mtime, `YYYY-MM-DD`, or null when the case has none. */
  report_updated_at: string | null
  report_sections: number
  /** ISO timestamp of the last question asked, or null if never opened. */
  last_qa_at: string | null
  turns: number
  pins: number
}
