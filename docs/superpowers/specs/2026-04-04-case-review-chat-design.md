# Case Review Chat — Design Spec
_Date: 2026-04-04_

## Overview

A React-based chat interface for human reviewers to interrogate an agentic backend system about individual cases (Consumer or Commercial). The agent pushes messages asynchronously; reviewers can ask questions and rewind conversation threads to any point.

---

## Tech Stack

- **Frontend**: React (Vite), TypeScript
- **State**: Zustand with localStorage persistence
- **Styling**: CSS Modules or plain CSS (no UI framework)
- **Fonts**: IBM Plex Mono (IDs, code), DM Sans (body), Playfair Display (brand)
- **Backend**: Separate service (not in scope); connected via HTTP + SSE
- **Real-time**: Server-Sent Events (SSE) for agent → UI push; HTTP POST for UI → agent

---

## Architecture

```
React App (Vite)
├── Left Panel  — case list (Consumer / Commercial sections)
└── Right Panel — chat interface for the selected case

State: Zustand store
├── caseList: string[]                    — ordered IDs, loaded from backend on mount
├── activeCase: string | null
├── threads: Record<caseId, Message[]>    — persisted to localStorage
└── sseStatus: 'connected' | 'disconnected'
```

One SSE connection is open at a time, tied to the active case. When the reviewer switches cases, the current SSE closes and a new one opens for the selected case. Unread dots persist for cases that received agent messages during a previous active session — they are not live-updated for cases that are currently inactive.

---

## API Contract

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/cases` | Load ordered list of case IDs on app mount |
| GET | `/api/cases/:id/stream` | SSE stream — agent pushes `Message` events |
| POST | `/api/cases/:id/message` | Reviewer sends a question; body: `{ text: string }` |
| POST | `/api/cases/:id/rewind` | Rewind agent memory; body: `{ messageId: string }` |

**SSE event format:**
```
event: message
data: {"id":"...","role":"agent","text":"...","timestamp":1712345678}
```

---

## Data Model

```ts
type Message = {
  id: string          // uuid
  role: "agent" | "reviewer"
  text: string
  timestamp: number   // unix ms
}

type Thread = Message[]

// Zustand store
type Store = {
  caseList: string[]
  activeCase: string | null
  threads: Record<string, Thread>
  sseStatus: 'connected' | 'disconnected'
  unread: Set<string>             // case IDs with unseen agent messages
}
```

---

## Component Tree

```
App
├── Sidebar
│   ├── AppHeader          — brand name + pulsing "Agentic System" live badge
│   ├── CaseSection label="Consumer"
│   │   └── CaseItem × n  — case ID, active highlight (left blue border), unread dot
│   └── CaseSection label="Commercial"
│       └── CaseItem × n
│
└── ChatPanel
    ├── ChatHeader          — case ID + SSE connection status badge ("Live" / "Reconnecting")
    ├── MessageList
    │   ├── MessageBubble × n   — role: agent (left) | reviewer (right), timestamp
    │   └── TypingIndicator     — animated dots; shown when SSE connected + silent >1s after reviewer sends
    └── InputBar
        ├── Textarea            — reviewer text input, label "Reviewer input"
        └── SendButton
```

---

## Data Flow

### Case selection
1. Set `activeCase` in store
2. Close any open SSE connection
3. Open SSE: `GET /api/cases/:id/stream`
4. Render thread from `threads[id]` (rehydrated from localStorage)
5. Clear unread dot for this case

### Reviewer sends message
1. Append optimistic `Message{role:"reviewer"}` to `threads[id]` immediately
2. `POST /api/cases/:id/message` with `{ text }`
3. Show `TypingIndicator` until next agent SSE message arrives
4. Persist updated thread to localStorage

### Agent pushes message (SSE)
1. Parse SSE event → `Message` (only received while this case is active)
2. Append to `threads[id]`
3. Hide `TypingIndicator`
4. Persist to localStorage

Note: when reviewer switches away, SSE closes — no further agent messages arrive for that case until it becomes active again. The unread dot set during a prior active session persists until the reviewer returns.

### Page reload
1. Zustand rehydrates `threads` from localStorage
2. Re-open SSE for `activeCase`
3. UI renders from cached thread instantly — no loading state needed

---

## Rewind

**UX:**
- Hover any message bubble → rewind icon (↩) appears inline (left of agent bubbles, right of reviewer bubbles)
- Click → confirmation popover: _"Rewind to this point? All messages after will be deleted."_
- Confirm → truncate thread; cancel → dismiss

**Behavior:**
1. `POST /api/cases/:id/rewind` with `{ messageId }` — backend resets agent memory to this point
2. `threads[id] = threads[id].slice(0, rewindIndex + 1)` — messages after rewind point are permanently discarded
3. Persist truncated thread to localStorage
4. SSE stays open — agent is ready for next input from rewound state
5. `TypingIndicator` hidden, unread dot cleared

---

## Visual Design

- **Theme**: Minimalist, American Express blue
- **Sidebar background**: `#00175A` (Amex navy)
- **Primary action color**: `#016FD0` (Amex blue)
- **Active case**: left border `#016FD0`, subtle background highlight
- **Unread dot**: `#016FD0` circle on case item
- **Live badge**: `#22c55e` pulsing dot
- **Agent bubbles**: white, light border, subtle shadow, square top-left corner
- **Reviewer bubbles**: `#016FD0` background, white text, square bottom-right corner
- **Typography**: IBM Plex Mono for all IDs and code; DM Sans for all prose; Playfair Display for brand header

---

## Out of Scope

- Backend / agentic system implementation
- Authentication / login
- Case creation or editing
- Exporting or printing threads
- Multi-reviewer collaboration / locking
