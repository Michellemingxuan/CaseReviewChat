# Product Requirements Document
## Case Review Chat Interface

**Version:** 1.0  
**Date:** 2026-04-04  
**Status:** Approved

---

## 1. Overview

### 1.1 Purpose

Case Review Chat is an internal tool that enables human case reviewers to interactively interrogate an agentic AI system about individual Consumer and Commercial cases. The interface provides a real-time chat experience where the agent can proactively push information, and reviewers can guide the investigation through natural-language questions.

### 1.2 Problem Statement

Case reviewers currently lack a structured, interactive interface to query the agentic backend about specific cases. Information retrieval is fragmented and does not support the dynamic, back-and-forth workflow that effective case review requires.

### 1.3 Goals

- Provide reviewers with a unified, case-centric chat interface
- Enable real-time, asynchronous agent communication without blocking the reviewer
- Allow reviewers to correct the course of an investigation by rewinding conversation history
- Maintain conversation history across page refreshes so reviewers can pick up where they left off

### 1.4 Non-Goals

- Backend / agentic system implementation
- Authentication or access control
- Case creation, editing, or data entry
- Exporting or printing case threads
- Multi-reviewer collaboration or case locking

---

## 2. Users

**Primary user:** Human case reviewer  
**Context:** Internal tooling, single-user sessions, desktop browser  
**Workflow:** Reviewer opens the tool, selects a case from the list, reads agent-generated insights, asks follow-up questions, and may rewind the conversation to re-examine a specific point.

---

## 3. Features

### 3.1 Case List (Left Panel)

**Description:** A persistent sidebar listing all assigned cases, grouped by type.

**Requirements:**
- Display cases in two sections: **Consumer** (prefix `C-`) and **Commercial** (prefix `M-`)
- Show only the case ID (e.g., `C-7891`) — no additional metadata
- Highlight the active case with a left blue border and subtle background
- Show an unread dot on cases that received agent messages during a prior active session
- Case list is loaded from the backend on app mount (`GET /api/cases`)

### 3.2 Chat Panel (Right Panel)

**Description:** A full-height chat interface that opens when a case is selected.

**Requirements:**
- Display a header with the active case ID and a live connection status badge ("Live" / "Reconnecting")
- Show the full conversation thread for the selected case, scrolled to the bottom
- Display a placeholder ("Select a case to begin review") when no case is selected
- Auto-scroll to the latest message as new messages arrive

### 3.3 Message Display

**Requirements:**
- Agent messages appear on the **left** with a white bubble, light border, and square top-left corner
- Reviewer messages appear on the **right** with an Amex blue bubble and square bottom-right corner
- Each message shows a role label ("Agent" / "Reviewer") and a formatted timestamp
- Messages persist across page refreshes (stored in localStorage per case ID)

### 3.4 Real-Time Agent Messages (SSE)

**Description:** The agent can push messages at any time without the reviewer sending a question first.

**Requirements:**
- One SSE connection (`GET /api/cases/:id/stream`) is maintained per active case
- Agent messages stream in asynchronously and appear immediately in the thread
- When the reviewer switches cases, the current SSE closes and a new one opens
- A pulsing green "Live" badge in the header indicates an active connection
- A yellow "Reconnecting" badge is shown when the connection drops

### 3.5 Reviewer Input

**Requirements:**
- A textarea at the bottom of the chat panel, labeled "Reviewer input"
- Send on button click or `Enter` key (`Shift+Enter` inserts a newline)
- Reviewer message appears optimistically in the thread immediately on send
- A typing indicator (animated three dots) appears after the reviewer sends, until the next agent message arrives
- Message is sent to the backend via `POST /api/cases/:id/message`

### 3.6 Rewind

**Description:** Reviewers can rewind the conversation to any prior message, resetting both the UI thread and the agent's memory at the backend.

**Requirements:**
- Hovering any message bubble reveals a rewind icon (↩)
- Clicking the icon shows a confirmation popover: *"Rewind to this point? All messages after will be deleted."*
- **Confirm:** truncates the thread at that message (inclusive); calls `POST /api/cases/:id/rewind` so the backend resets agent memory
- **Cancel:** dismisses the popover with no changes
- Messages after the rewind point are permanently discarded (no undo)
- The SSE connection remains open after rewind — the agent is ready for the next input

---

## 4. API Contract

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/cases` | Load ordered list of case IDs on app mount |
| GET | `/api/cases/:id/stream` | SSE — agent pushes messages asynchronously |
| POST | `/api/cases/:id/message` | Reviewer sends a question; body: `{ text: string }` |
| POST | `/api/cases/:id/rewind` | Rewind agent memory; body: `{ messageId: string }` |

**SSE event format:**
```
event: message
data: {"id":"<uuid>","role":"agent","text":"...","timestamp":<unix_ms>}
```

---

## 5. Design

### 5.1 Visual Theme

- **Style:** Minimalist, American Express brand colors
- **Sidebar background:** `#00175A` (Amex navy)
- **Primary action / accent:** `#016FD0` (Amex blue)
- **Live indicator:** `#22c55e` pulsing green dot

### 5.2 Typography

| Usage | Font |
|-------|------|
| Case IDs, code | IBM Plex Mono |
| Body text, UI labels | DM Sans |
| Brand header | Playfair Display |

### 5.3 Layout

```
┌──────────────────────────────────────────────────────┐
│  [Sidebar 240px]          [Chat Panel flex-1]         │
│  ┌────────────────┐       ┌──────────────────────┐    │
│  │ • Agentic Sys  │       │ C-7891    [● Live]   │    │
│  │ Case Review    │       ├──────────────────────┤    │
│  ├────────────────┤       │                      │    │
│  │ CONSUMER       │       │  Agent: ...          │    │
│  │ C-7891  ←active│       │           Reviewer:..│    │
│  │ C-4523  ●unread│       │  Agent: ...          │    │
│  │ C-2847         │       │  [···]               │    │
│  ├────────────────┤       ├──────────────────────┤    │
│  │ COMMERCIAL     │       │ Reviewer input       │    │
│  │ M-1892         │       │ [textarea]    [Send] │    │
│  │ M-5671         │       └──────────────────────┘    │
│  └────────────────┘                                   │
└──────────────────────────────────────────────────────┘
```

---

## 6. Technical Requirements

| Requirement | Detail |
|-------------|--------|
| Framework | React 18 + TypeScript (Vite) |
| State management | Zustand with localStorage persistence |
| Real-time | Server-Sent Events (SSE) for agent push; HTTP POST for reviewer input |
| Persistence | Conversation threads stored in localStorage per case ID, survive page refresh |
| Styling | CSS Modules, no UI framework |
| Backend | Separate service (not in scope of this product) |

---

## 7. Success Criteria

- Reviewer can select any case and see its conversation history immediately (even after page refresh)
- Agent messages appear in the thread within 1 second of the backend emitting them
- Reviewer can send a message and see it in the thread before the backend responds
- Rewind correctly truncates the UI thread and the backend confirms memory reset
- Connection status badge accurately reflects SSE state

---

## 8. Open Questions

_None at this time._
