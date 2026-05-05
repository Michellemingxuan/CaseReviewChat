# Product Requirements Document
## Case Review Chat ↔ AgenticSys_v2 Integration

**Version:** 1.0
**Date:** 2026-05-03
**Status:** In implementation
**Owner:** m.liu

---

## 1. Overview

### 1.1 Purpose

Wire the existing Case Review Chat React frontend (`CaseReviewChat/`) to the existing Python agentic backend (`../AgenticSys_v2/`) so that a reviewer asking a question in the chat box triggers a real agentic run, and the right-side panels (audit trace + orchestration flow) render live from that run instead of static HTML.

### 1.2 Background

Two systems exist today:

- **Frontend** — React 19 + TypeScript + Vite. Has a working chat panel, Zustand store, SSE hook, and a JS mock server on port 3001. A separate static design demo (`agentic-collab.html`) defines the target UI for the audit trace + orchestration flow panels.
- **Backend** — Python CLI (`AgenticSys_v2/main.py`) that runs an OpenAI-Agents-SDK orchestrator graph: `ChatAgent.screen` → `Orchestrator.run` → specialists (`crossbu`, etc.) + `report_agent` + `general_specialist` → `FinalAnswer`. Has typed Pydantic models in `models/types.py` and a post-hoc markdown renderer (`notebooks/run_question_suite.py:_render_turn_md`) that already produces the bracketed `[QUESTION CHECK] / [TEAM CONSTRUCTION] / [SPECIALIST ANALYSIS] / [REPORT AGENT ANALYSIS] / [FINAL SYNTHESIS]` format the new UI expects.

The data shapes line up. What's missing is the wire — there is no HTTP server, no streaming, and the frontend's mock server returns a hardcoded "system is under construction" string.

### 1.3 Goals

- Reviewer types a question → backend dispatches a real agentic run → frontend renders chat answer + structured trace live, in under 1 second from first event.
- The trace panel is data-driven: each run emits typed events that the React components render. No hardcoded agent names.
- Multi-turn conversation memory works (follow-ups land on the same orchestrator session).
- Drop-in: running the new Python server replaces the JS mock server on the same port and contract.

### 1.4 Non-Goals

- Auth, user management, RBAC.
- Production deploy (Docker, k8s, ALB). Local-dev only.
- The orchestration-graph SVG visualization. Out of scope for v1; can be a static placeholder. Audit trace is the hero panel.
- The "Compare Path" / "Export Trace" buttons. Wired as no-ops.
- New backend agent capabilities. Frontend exposes what the backend already produces.
- Database persistence. In-memory turn store is acceptable for v1; the existing JSONL `EventLogger` continues to write disk logs.

---

## 2. Users & Use Cases

**Primary user:** Internal case reviewer (single user, desktop browser, dev environment).

**Use case:**
1. Reviewer opens the app, picks a case from the sidebar.
2. Reviewer types a question. Within ~200ms, the audit trace panel shows `[QUESTION CHECK]` filling in.
3. Within ~500ms, `[TEAM CONSTRUCTION]` appears with the tools the orchestrator chose.
4. As each specialist completes, its analysis block streams into the trace.
5. `[FINAL SYNTHESIS]` appears with the answer, which also lands as the agent bubble in the chat.
6. Reviewer asks a follow-up; orchestrator memory carries forward via `result.to_input_list()`.

---

## 3. Architecture

```
┌───────────────────────────────┐         HTTP / SSE          ┌──────────────────────────────┐
│   Frontend (Vite, :5173)      │ ◄──────────────────────────► │  Backend (Flask, :3001)      │
│                               │   /api/cases                 │                              │
│   React components            │   /api/cases/:id/turn  POST  │  CaseSession store           │
│   Zustand store               │   /api/cases/:id/stream SSE  │  (in-memory)                 │
│   SSE hook                    │   /api/cases/:id/rewind POST │                              │
│                               │                              │  Orchestrator.run_streamed   │
│   AuditTracePanel             │                              │  ChatAgent / ReportAgent /   │
│   ChatPanel                   │                              │  Specialists / Synthesis     │
└───────────────────────────────┘                              └──────────────────────────────┘
```

**Trust boundary:** None for v1 (local dev). Server binds to `127.0.0.1:3001`.

**Streaming model:** One long-lived SSE connection per active case. Server pushes typed events. Reviewer messages POST'd via separate HTTP, then echoed back over SSE so the frontend has a single source of truth for the thread.

---

## 4. API Contract

### 4.1 REST

| Method | Path                         | Body                  | Response                     |
|--------|------------------------------|-----------------------|------------------------------|
| GET    | `/api/cases`                 | —                     | `{consumer: string[], commercial: string[]}` |
| POST   | `/api/cases/{id}/turn`       | `{text: string}`      | `{turn_id: string}` (202)    |
| POST   | `/api/cases/{id}/rewind`     | `{messageId: string}` | `204`                        |
| GET    | `/api/cases/{id}/stream`     | —                     | `text/event-stream` (SSE)    |

The legacy `POST /api/cases/{id}/message` is retained as an alias for `POST /api/cases/{id}/turn` for compatibility with the existing React app's `postMessage` call.

### 4.2 SSE event schema

All events have `event:` and `data:` fields. `data:` is JSON.

```
event: reviewer_message
data: {id, role:"reviewer", text, timestamp, turn_id}

event: turn_started
data: {turn_id, question, started_at}

event: question_check
data: {turn_id, passed: bool, reason: str, redacted_question: str, in_scope: bool, outcome: "ok"|"screen_rejected"|"out_of_scope"|"orchestrator_error"}

event: team_plan
data: {turn_id, tool_calls: [{call_id, tool, sub_question}, ...]}

event: agent_started
data: {turn_id, call_id, tool, started_at}

event: agent_completed
data: {turn_id, call_id, tool, payload, duration_ms}
  # payload schema depends on tool:
  #   report_agent       → ReportDraft         {coverage, answer, evidence_excerpts, files_consulted}
  #   general_specialist → ReviewReport        {resolved, open_conflicts, cross_domain_insights, ...}
  #   <other>            → SpecialistOutput    {findings, evidence, implications, data_gaps, raw_data}

event: final
data: {turn_id, answer, flags, timeline, data_pull_request}

event: agent_message
data: {id, role:"agent", text, timestamp, turn_id}
  # final.answer rendered to the chat thread; emitted once per turn after `final`.

event: turn_done
data: {turn_id, ended_at, duration_ms, outcome}

event: error
data: {turn_id, message, recoverable: bool}
```

Comment-only keepalive `: ping` every 15 s.

### 4.3 Backwards-compat with legacy mock

The legacy `event: message` (one shape: `{id, role, text, timestamp}`) is retained — emitted alongside `reviewer_message` and `agent_message` so the existing `useSSE` hook still works during the migration.

---

## 5. Backend Implementation (`AgenticSys_v2`)

### 5.1 New file: `server.py`

A Flask app at the project root that imports the existing orchestrator stack.

**Structure:**

- `CaseSession` class — holds per-case state: `gateway`, `catalog`, `clients`, `pillar_yaml`, `chat_agent`, `turn_history` (list of `(input_list, FinalAnswer)`), and a `queue.Queue` per active SSE subscriber.
- `SESSIONS: dict[str, CaseSession]` — keyed by `case_id`. Lazily created on first request.
- `app = Flask(__name__)` with CORS open for `localhost:5173`.
- Routes: `/api/cases`, `/api/cases/<id>/turn`, `/api/cases/<id>/stream`, `/api/cases/<id>/rewind`, `/api/cases/<id>/message` (alias).
- A background `threading.Thread` per turn: invokes `asyncio.run(_run_turn_streamed(...))`, which calls `Runner.run_streamed(orchestrator_agent, ...)` and pushes events to all subscribers' queues as items arrive.
- Subscribers consume from their queue inside the SSE generator, format as `event: ... \ndata: ...\n\n`.

### 5.2 Streaming the orchestrator

Use `agents.Runner.run_streamed` (the SDK supports this). For each `RunItem`:

- `ToolCallItem`        → emit `team_plan` (collected per turn) then `agent_started`
- `ToolCallOutputItem`  → emit `agent_completed` with the deserialized payload
- `MessageOutputItem`   → ignored at the orchestrator layer (final structured output goes via `final`)

After the stream completes, emit `final`, `agent_message`, `turn_done`.

### 5.3 Multi-turn memory

`CaseSession.turn_history` stores per-turn `RunResult.to_input_list()`. Subsequent turns concatenate prior input lists so the orchestrator sees the full conversation history per the SDK's memory pattern.

### 5.4 Cases / data source

On `/api/cases`, return cases from `LocalDataGateway.list_case_ids()`. Heuristic split:
- IDs starting with `C-` → consumer.
- IDs starting with `M-` → commercial.
- Numeric or other → consumer (default).

Backend currently uses real or simulated CSV folders; `--data-source auto` resolution from `main.py` is reused.

### 5.5 Run

```
cd ../AgenticSys_v2
pip install -r requirements.txt
python server.py
```

Listens on `127.0.0.1:3001`. Vite proxy already routes `/api/*` there.

---

## 6. Frontend Implementation (`CaseReviewChat`)

### 6.1 Type additions (`src/types.ts`)

```ts
export type Outcome = 'ok' | 'screen_rejected' | 'out_of_scope' | 'orchestrator_error'

export type QuestionCheck = { passed: boolean; reason: string; redacted_question: string; in_scope: boolean; outcome: Outcome }
export type ToolCall = { call_id: string; tool: string; sub_question: string }
export type AgentPayload = ReportDraft | ReviewReport | SpecialistOutput | Record<string, unknown>
export type ReportDraft = { coverage: 'explicit' | 'implicit' | 'not_mentioned'; answer: string; evidence_excerpts: string[]; files_consulted: string[] }
export type SpecialistOutput = { findings: string; evidence: string[]; implications: string[]; data_gaps: string[]; raw_data: Record<string, unknown> }
export type ReviewReport = { resolved: unknown[]; open_conflicts: unknown[]; cross_domain_insights: string[] }

export type Turn = {
  turn_id: string
  question: string
  started_at: number
  ended_at?: number
  duration_ms?: number
  question_check?: QuestionCheck
  team_plan?: ToolCall[]
  agent_runs: Array<{ call_id: string; tool: string; started_at?: number; duration_ms?: number; payload?: AgentPayload }>
  final?: { answer: string; flags: string[]; timeline: unknown[]; data_pull_request: unknown }
  outcome?: Outcome
  status: 'streaming' | 'done' | 'error'
}
```

### 6.2 Store additions (`src/store.ts`)

```ts
turns: Record<string, Turn[]>            // by caseId
activeTurnId: Record<string, string|null> // by caseId — which turn the right panel inspects
```

Action handlers ingest each SSE event type and merge into the matching `Turn` record.

### 6.3 SSE hook updates (`src/hooks/useSSE.ts`)

Subscribe to `message` (legacy), `reviewer_message`, `turn_started`, `question_check`, `team_plan`, `agent_started`, `agent_completed`, `final`, `agent_message`, `turn_done`, `error`. Dispatch each into the appropriate store action.

### 6.4 New components

- `src/components/AuditTracePanel/AuditTracePanel.tsx` — renders the `[QUESTION CHECK] / [TEAM CONSTRUCTION] / [SPECIALIST ANALYSIS — <tool>] / [REPORT AGENT ANALYSIS] / [FINAL SYNTHESIS]` blocks for the active turn. Visual style ported from `agentic-collab.html`.
- `src/components/Workspace/Workspace.tsx` — three-zone layout (sidebar | chat | right-stack with audit + flow placeholder). Uses CSS grid + the custom-property resizer pattern from `agentic-collab.html`.

The existing `ChatPanel` keeps working but is wrapped by `Workspace`. Clicking an answer bubble sets `activeTurnId`, which scopes the audit-trace panel.

### 6.5 No regression

The existing `mockServer.ts` stays in the repo and stays runnable via `npm run mock`. The frontend works with either backend; the new types/components fall back gracefully when SSE only emits the legacy `message` event.

---

## 7. Implementation Phases

**Phase 1 — Backend wire (this PR):**
1. `server.py` in `AgenticSys_v2/` with cases / turn / stream / rewind routes.
2. SSE emits `reviewer_message`, `turn_started`, `question_check`, `team_plan`, `agent_started`, `agent_completed`, `final`, `agent_message`, `turn_done`.
3. In-memory turn history per case.

**Phase 2 — Frontend types & store (this PR):**
1. New types in `types.ts`.
2. Store actions for each event.
3. `useSSE` parses all event types.

**Phase 3 — AuditTracePanel (this PR):**
1. New React component rendering the bracketed blocks for the active turn.
2. Wraps existing ChatPanel in a Workspace layout.
3. Click answer bubble → set active turn.

**Phase 4 (deferred):**
- Orchestration graph with real nodes from `team_plan`.
- Resizable panels.
- Rewind wired to backend turn truncation.
- Flag Issue captures the turn into a review queue.

---

## 8. Success Criteria

- Reviewer asks a question → audit trace panel shows `[QUESTION CHECK]` block within 500 ms.
- Each specialist's `[SPECIALIST ANALYSIS]` block appears as it completes (visible streaming, not all-at-once).
- Final answer in the chat matches the synthesis block in the audit trace.
- Asking a follow-up uses orchestrator conversation memory (verifiable: question 2 referencing "the previous answer" works).
- `npm run mock` (legacy mock) and `python server.py` (new backend) are both drop-in replacements; the React app code is unchanged between them.

---

## 9. Risks & Open Questions

- **OpenAI Agents SDK streaming API surface** — confirmed via inspection that `Runner.run_streamed` exists; need to verify exact item-yield semantics in our SDK pinned version.
- **Long-running runs** — if a turn takes >30 s the SSE connection should hold open via the `: ping` keepalive. Vite proxy passthrough confirmed.
- **Concurrent turns per case** — v1 serializes per case (one turn at a time). Frontend disables the composer while `status: 'streaming'`.
- **Rewind in the orchestrator** — backend `Orchestrator` has no rewind primitive yet; v1 just truncates the frontend thread + clears `turn_history` past the rewind point. Reviewer effectively starts fresh from that point with new context.
