# Case Review Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React chat interface where human reviewers can interrogate an agentic backend about Consumer and Commercial cases, with async agent message streaming and rewind support.

**Architecture:** Vite + React + TypeScript single-page app. Zustand manages all state with localStorage persistence. One SSE connection is open at a time per active case; HTTP POST sends reviewer messages. The backend is a separate service — this plan only covers the frontend.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, CSS Modules, Google Fonts (IBM Plex Mono, DM Sans, Playfair Display)

---

## File Map

```
src/
├── main.tsx                        # Vite entry point
├── App.tsx                         # Root layout: Sidebar + ChatPanel side by side
├── index.css                       # Global reset, font imports, CSS variables
├── types.ts                        # Message, Store type definitions
├── store.ts                        # Zustand store with localStorage persistence
├── api.ts                          # fetch wrappers for all 4 API endpoints
├── hooks/
│   └── useSSE.ts                   # Opens/closes SSE connection, feeds messages to store
├── components/
│   ├── Sidebar/
│   │   ├── Sidebar.tsx             # Sidebar shell with AppHeader + two CaseSections
│   │   ├── Sidebar.module.css
│   │   ├── AppHeader.tsx           # Brand name + pulsing live badge
│   │   ├── AppHeader.module.css
│   │   ├── CaseSection.tsx         # Section label + list of CaseItems
│   │   ├── CaseSection.module.css
│   │   ├── CaseItem.tsx            # Single case row: ID, active border, unread dot
│   │   └── CaseItem.module.css
│   └── ChatPanel/
│       ├── ChatPanel.tsx           # Panel shell: ChatHeader + MessageList + InputBar
│       ├── ChatPanel.module.css
│       ├── ChatHeader.tsx          # Case ID + Live/Reconnecting badge
│       ├── ChatHeader.module.css
│       ├── MessageList.tsx         # Scrollable list of MessageBubbles + TypingIndicator
│       ├── MessageList.module.css
│       ├── MessageBubble.tsx       # Single message: role-based alignment, rewind hover icon
│       ├── MessageBubble.module.css
│       ├── TypingIndicator.tsx     # Animated three-dot indicator
│       ├── TypingIndicator.module.css
│       ├── InputBar.tsx            # Textarea + Send button
│       └── InputBar.module.css
└── __tests__/
    ├── store.test.ts
    ├── api.test.ts
    └── useSSE.test.ts
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

- [ ] **Step 1: Scaffold Vite project**

```bash
cd "/Users/mingxuanliu/Library/CloudStorage/GoogleDrive-mingxuan99michelle@gmail.com/My Drive/Projs/CaseReviewChat"
npm create vite@latest . -- --template react-ts
npm install
```

Expected: `node_modules/` installed, dev server runnable.

- [ ] **Step 2: Install dependencies**

```bash
npm install zustand
npm install --save-dev vitest @testing-library/react @testing-library/user-event jsdom @vitest/coverage-v8
```

- [ ] **Step 3: Configure Vitest in vite.config.ts**

Replace the generated `vite.config.ts` with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
```

- [ ] **Step 4: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Replace src/index.css with global styles + font imports**

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@600&display=swap');

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --amex-navy: #00175A;
  --amex-blue: #016FD0;
  --green-live: #22c55e;
  --bg-app: #fafafa;
  --bg-white: #ffffff;
  --border: #e8e8e8;
  --text-primary: #1a1a2e;
  --text-muted: #999999;
  --font-mono: 'IBM Plex Mono', monospace;
  --font-body: 'DM Sans', sans-serif;
  --font-brand: 'Playfair Display', serif;
}

html, body, #root {
  height: 100%;
  font-family: var(--font-body);
  background: var(--bg-app);
  color: var(--text-primary);
}
```

- [ ] **Step 6: Replace src/App.tsx with layout shell**

```tsx
import './index.css'

function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ width: 240, flexShrink: 0, background: 'var(--amex-navy)' }}>
        {/* Sidebar — Task 3 */}
      </div>
      <div style={{ flex: 1, background: 'var(--bg-white)' }}>
        {/* ChatPanel — Task 5 */}
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 7: Run dev server to verify scaffold**

```bash
npm run dev
```

Expected: browser shows empty two-column layout (navy left, white right). No errors in console.

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Vite React TS project with Zustand and Vitest"
```

---

## Task 2: Types, Store, and API

**Files:**
- Create: `src/types.ts`, `src/store.ts`, `src/api.ts`, `src/__tests__/store.test.ts`, `src/__tests__/api.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `src/__tests__/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import type { Message } from '../types'

const msg = (id: string, role: 'agent' | 'reviewer'): Message => ({
  id,
  role,
  text: `text-${id}`,
  timestamp: Date.now(),
})

beforeEach(() => {
  // Reset store between tests
  useStore.setState({
    caseList: [],
    activeCase: null,
    threads: {},
    sseStatus: 'disconnected',
    unread: new Set(),
  })
  localStorage.clear()
})

describe('store', () => {
  it('setActiveCase updates activeCase and clears unread for that case', () => {
    useStore.setState({ unread: new Set(['C-001']) })
    useStore.getState().setActiveCase('C-001')
    expect(useStore.getState().activeCase).toBe('C-001')
    expect(useStore.getState().unread.has('C-001')).toBe(false)
  })

  it('appendMessage adds message to thread', () => {
    useStore.getState().appendMessage('C-001', msg('m1', 'agent'))
    expect(useStore.getState().threads['C-001']).toHaveLength(1)
  })

  it('rewindThread truncates thread after the given messageId (inclusive)', () => {
    useStore.getState().appendMessage('C-001', msg('m1', 'agent'))
    useStore.getState().appendMessage('C-001', msg('m2', 'reviewer'))
    useStore.getState().appendMessage('C-001', msg('m3', 'agent'))
    useStore.getState().rewindThread('C-001', 'm1')
    expect(useStore.getState().threads['C-001']).toHaveLength(1)
    expect(useStore.getState().threads['C-001'][0].id).toBe('m1')
  })

  it('setCaseList sets caseList', () => {
    useStore.getState().setCaseList(['C-001', 'C-002'])
    expect(useStore.getState().caseList).toEqual(['C-001', 'C-002'])
  })

  it('setSseStatus updates sseStatus', () => {
    useStore.getState().setSseStatus('connected')
    expect(useStore.getState().sseStatus).toBe('connected')
  })

  it('markUnread adds caseId to unread set', () => {
    useStore.getState().markUnread('C-002')
    expect(useStore.getState().unread.has('C-002')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `../store` not found.

- [ ] **Step 3: Write types.ts**

Create `src/types.ts`:

```ts
export type Message = {
  id: string
  role: 'agent' | 'reviewer'
  text: string
  timestamp: number
}

export type SseStatus = 'connected' | 'disconnected'

export type StoreState = {
  caseList: string[]
  activeCase: string | null
  threads: Record<string, Message[]>
  sseStatus: SseStatus
  unread: Set<string>
  // actions
  setCaseList: (ids: string[]) => void
  setActiveCase: (id: string) => void
  appendMessage: (caseId: string, msg: Message) => void
  rewindThread: (caseId: string, messageId: string) => void
  setSseStatus: (status: SseStatus) => void
  markUnread: (caseId: string) => void
}
```

- [ ] **Step 4: Write store.ts**

Create `src/store.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Message, SseStatus, StoreState } from './types'

const STORAGE_KEY = 'case-review-threads'

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      caseList: [],
      activeCase: null,
      threads: {},
      sseStatus: 'disconnected' as SseStatus,
      unread: new Set<string>(),

      setCaseList: (ids) => set({ caseList: ids }),

      setActiveCase: (id) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.delete(id)
          return { activeCase: id, unread }
        }),

      appendMessage: (caseId, msg: Message) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [caseId]: [...(state.threads[caseId] ?? []), msg],
          },
        })),

      rewindThread: (caseId, messageId) =>
        set((state) => {
          const thread = state.threads[caseId] ?? []
          const idx = thread.findIndex((m) => m.id === messageId)
          if (idx === -1) return {}
          return {
            threads: {
              ...state.threads,
              [caseId]: thread.slice(0, idx + 1),
            },
          }
        }),

      setSseStatus: (status) => set({ sseStatus: status }),

      markUnread: (caseId) =>
        set((state) => {
          const unread = new Set(state.unread)
          unread.add(caseId)
          return { unread }
        }),
    }),
    {
      name: STORAGE_KEY,
      // Zustand persist doesn't handle Set natively — serialize/deserialize manually
      serialize: (state) =>
        JSON.stringify({ ...state, state: { ...state.state, unread: [...state.state.unread] } }),
      deserialize: (str) => {
        const parsed = JSON.parse(str)
        parsed.state.unread = new Set(parsed.state.unread)
        return parsed
      },
    }
  )
)
```

- [ ] **Step 5: Run store tests to verify they pass**

```bash
npm test src/__tests__/store.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 6: Write api.ts**

Create `src/api.ts`:

```ts
const BASE = '/api'

export async function fetchCaseList(): Promise<string[]> {
  const res = await fetch(`${BASE}/cases`)
  if (!res.ok) throw new Error(`fetchCaseList failed: ${res.status}`)
  return res.json()
}

export async function postMessage(caseId: string, text: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`)
}

export async function postRewind(caseId: string, messageId: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/rewind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
  })
  if (!res.ok) throw new Error(`postRewind failed: ${res.status}`)
}

export function openSSE(caseId: string): EventSource {
  return new EventSource(`${BASE}/cases/${caseId}/stream`)
}
```

- [ ] **Step 7: Write api tests**

Create `src/__tests__/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCaseList, postMessage, postRewind } from '../api'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('fetchCaseList', () => {
  it('returns array of case IDs on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['C-001', 'C-002'],
    } as Response)

    const result = await fetchCaseList()
    expect(result).toEqual(['C-001', 'C-002'])
    expect(fetch).toHaveBeenCalledWith('/api/cases')
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    await expect(fetchCaseList()).rejects.toThrow('fetchCaseList failed: 500')
  })
})

describe('postMessage', () => {
  it('posts text to correct endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    await postMessage('C-001', 'hello')
    expect(fetch).toHaveBeenCalledWith('/api/cases/C-001/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
  })
})

describe('postRewind', () => {
  it('posts messageId to correct endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    await postRewind('C-001', 'm1')
    expect(fetch).toHaveBeenCalledWith('/api/cases/C-001/rewind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'm1' }),
    })
  })
})
```

- [ ] **Step 8: Run api tests**

```bash
npm test src/__tests__/api.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store.ts src/api.ts src/__tests__/store.test.ts src/__tests__/api.test.ts
git commit -m "feat: add types, Zustand store with localStorage persistence, and API helpers"
```

---

## Task 3: useSSE Hook

**Files:**
- Create: `src/hooks/useSSE.ts`, `src/__tests__/useSSE.test.ts`

- [ ] **Step 1: Write failing useSSE tests**

Create `src/__tests__/useSSE.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../hooks/useSSE'
import { useStore } from '../store'
import type { Message } from '../types'

// Minimal EventSource mock
class MockEventSource {
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  static instances: MockEventSource[] = []

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  emit(data: Message) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
  useStore.setState({
    caseList: [],
    activeCase: null,
    threads: {},
    sseStatus: 'disconnected',
    unread: new Set(),
  })
})

describe('useSSE', () => {
  it('opens SSE connection for given caseId', () => {
    renderHook(() => useSSE('C-001'))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/cases/C-001/stream')
  })

  it('sets sseStatus to connected after first message', () => {
    const { } = renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    const msg: Message = { id: 'm1', role: 'agent', text: 'hello', timestamp: 1 }
    act(() => { es.emit(msg) })
    expect(useStore.getState().sseStatus).toBe('connected')
  })

  it('appends received message to thread', () => {
    renderHook(() => useSSE('C-001'))
    const es = MockEventSource.instances[0]
    const msg: Message = { id: 'm1', role: 'agent', text: 'hello', timestamp: 1 }
    act(() => { es.emit(msg) })
    expect(useStore.getState().threads['C-001']).toHaveLength(1)
    expect(useStore.getState().threads['C-001'][0].text).toBe('hello')
  })

  it('closes SSE connection on unmount', () => {
    const { unmount } = renderHook(() => useSSE('C-001'))
    unmount()
    expect(MockEventSource.instances[0].close).toHaveBeenCalled()
  })

  it('closes old and opens new SSE when caseId changes', () => {
    const { rerender } = renderHook(({ id }) => useSSE(id), { initialProps: { id: 'C-001' } })
    rerender({ id: 'C-002' })
    expect(MockEventSource.instances[0].close).toHaveBeenCalled()
    expect(MockEventSource.instances[1].url).toBe('/api/cases/C-002/stream')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test src/__tests__/useSSE.test.ts
```

Expected: FAIL — `../hooks/useSSE` not found.

- [ ] **Step 3: Write useSSE.ts**

Create `src/hooks/useSSE.ts`:

```ts
import { useEffect, useRef } from 'react'
import { openSSE } from '../api'
import { useStore } from '../store'
import type { Message } from '../types'

export function useSSE(caseId: string | null) {
  const appendMessage = useStore((s) => s.appendMessage)
  const setSseStatus = useStore((s) => s.setSseStatus)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!caseId) return

    const es = openSSE(caseId)
    esRef.current = es

    es.onmessage = (event: MessageEvent) => {
      try {
        const msg: Message = JSON.parse(event.data)
        setSseStatus('connected')
        appendMessage(caseId, msg)
      } catch {
        console.error('Failed to parse SSE message', event.data)
      }
    }

    es.onerror = () => {
      setSseStatus('disconnected')
    }

    return () => {
      es.close()
      esRef.current = null
      setSseStatus('disconnected')
    }
  }, [caseId, appendMessage, setSseStatus])
}
```

- [ ] **Step 4: Run useSSE tests**

```bash
npm test src/__tests__/useSSE.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSSE.ts src/__tests__/useSSE.test.ts
git commit -m "feat: add useSSE hook — opens/closes EventSource per active case"
```

---

## Task 4: Sidebar Components

**Files:**
- Create: `src/components/Sidebar/Sidebar.tsx`, `Sidebar.module.css`, `AppHeader.tsx`, `AppHeader.module.css`, `CaseSection.tsx`, `CaseSection.module.css`, `CaseItem.tsx`, `CaseItem.module.css`

- [ ] **Step 1: Create AppHeader**

Create `src/components/Sidebar/AppHeader.tsx`:

```tsx
import styles from './AppHeader.module.css'

export function AppHeader() {
  return (
    <div className={styles.header}>
      <div className={styles.badge}>
        <span className={styles.badgeDot} />
        <span className={styles.badgeText}>Agentic System</span>
      </div>
      <div className={styles.brand}>Case Review</div>
    </div>
  )
}
```

Create `src/components/Sidebar/AppHeader.module.css`:

```css
.header {
  padding: 18px 16px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badgeDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green-live);
  box-shadow: 0 0 6px var(--green-live);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.badgeText {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.brand {
  margin-top: 10px;
  font-family: var(--font-brand);
  font-size: 15px;
  color: white;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 2: Create CaseItem**

Create `src/components/Sidebar/CaseItem.tsx`:

```tsx
import styles from './CaseItem.module.css'

type Props = {
  id: string
  isActive: boolean
  hasUnread: boolean
  onClick: (id: string) => void
}

export function CaseItem({ id, isActive, hasUnread, onClick }: Props) {
  return (
    <button
      className={`${styles.item} ${isActive ? styles.active : ''}`}
      onClick={() => onClick(id)}
    >
      <span className={styles.id}>{id}</span>
      {hasUnread && <span className={styles.unreadDot} aria-label="unread messages" />}
    </button>
  )
}
```

Create `src/components/Sidebar/CaseItem.module.css`:

```css
.item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 9px 16px;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}

.item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.item.active {
  background: rgba(1, 111, 208, 0.22);
  border-left-color: var(--amex-blue);
}

.id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  flex: 1;
}

.item.active .id,
.item:hover .id {
  color: white;
}

.unreadDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--amex-blue);
  flex-shrink: 0;
}
```

- [ ] **Step 3: Create CaseSection**

Create `src/components/Sidebar/CaseSection.tsx`:

```tsx
import { CaseItem } from './CaseItem'
import styles from './CaseSection.module.css'

type Props = {
  label: string
  cases: string[]
  activeCase: string | null
  unread: Set<string>
  onSelect: (id: string) => void
}

export function CaseSection({ label, cases, activeCase, unread, onSelect }: Props) {
  if (cases.length === 0) return null
  return (
    <div>
      <div className={styles.label}>{label}</div>
      {cases.map((id) => (
        <CaseItem
          key={id}
          id={id}
          isActive={id === activeCase}
          hasUnread={unread.has(id)}
          onClick={onSelect}
        />
      ))}
    </div>
  )
}
```

Create `src/components/Sidebar/CaseSection.module.css`:

```css
.label {
  padding: 14px 16px 6px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}
```

- [ ] **Step 4: Create Sidebar**

Create `src/components/Sidebar/Sidebar.tsx`:

```tsx
import { AppHeader } from './AppHeader'
import { CaseSection } from './CaseSection'
import styles from './Sidebar.module.css'

type Props = {
  consumerCases: string[]
  commercialCases: string[]
  activeCase: string | null
  unread: Set<string>
  onSelect: (id: string) => void
}

export function Sidebar({ consumerCases, commercialCases, activeCase, unread, onSelect }: Props) {
  return (
    <nav className={styles.sidebar}>
      <AppHeader />
      <div className={styles.list}>
        <CaseSection
          label="Consumer"
          cases={consumerCases}
          activeCase={activeCase}
          unread={unread}
          onSelect={onSelect}
        />
        <div className={styles.divider} />
        <CaseSection
          label="Commercial"
          cases={commercialCases}
          activeCase={activeCase}
          unread={unread}
          onSelect={onSelect}
        />
      </div>
    </nav>
  )
}
```

Create `src/components/Sidebar/Sidebar.module.css`:

```css
.sidebar {
  width: 240px;
  height: 100%;
  background: var(--amex-navy);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
  margin: 10px 16px;
}
```

- [ ] **Step 5: Wire Sidebar into App.tsx**

Sidebar takes case IDs split by prefix: `C-` = Consumer, `M-` = Commercial.

Replace `src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { useStore } from './store'
import { fetchCaseList } from './api'
import { Sidebar } from './components/Sidebar/Sidebar'
import './index.css'

function App() {
  const caseList = useStore((s) => s.caseList)
  const activeCase = useStore((s) => s.activeCase)
  const unread = useStore((s) => s.unread)
  const setCaseList = useStore((s) => s.setCaseList)
  const setActiveCase = useStore((s) => s.setActiveCase)

  useEffect(() => {
    fetchCaseList().then(setCaseList).catch(console.error)
  }, [setCaseList])

  const consumerCases = caseList.filter((id) => id.startsWith('C-'))
  const commercialCases = caseList.filter((id) => id.startsWith('M-'))

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        consumerCases={consumerCases}
        commercialCases={commercialCases}
        activeCase={activeCase}
        unread={unread}
        onSelect={setActiveCase}
      />
      <div style={{ flex: 1, background: 'var(--bg-white)' }}>
        {/* ChatPanel — Task 5 */}
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 6: Run dev server to verify sidebar renders**

```bash
npm run dev
```

Expected: navy sidebar with "Case Review" brand and pulsing green dot. No errors. (List will be empty until backend is connected.)

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar/ src/App.tsx
git commit -m "feat: add Sidebar with AppHeader, CaseSection, and CaseItem components"
```

---

## Task 5: ChatPanel — Header, MessageBubble, TypingIndicator

**Files:**
- Create: `src/components/ChatPanel/ChatHeader.tsx`, `ChatHeader.module.css`, `src/components/ChatPanel/MessageBubble.tsx`, `MessageBubble.module.css`, `src/components/ChatPanel/TypingIndicator.tsx`, `TypingIndicator.module.css`

- [ ] **Step 1: Create ChatHeader**

Create `src/components/ChatPanel/ChatHeader.tsx`:

```tsx
import type { SseStatus } from '../../types'
import styles from './ChatHeader.module.css'

type Props = {
  caseId: string
  sseStatus: SseStatus
}

export function ChatHeader({ caseId, sseStatus }: Props) {
  return (
    <div className={styles.header}>
      <div>
        <div className={styles.caseId}>{caseId}</div>
        <div className={styles.meta}>
          {caseId.startsWith('C-') ? 'Consumer' : 'Commercial'} · active session
        </div>
      </div>
      <div className={`${styles.badge} ${sseStatus === 'connected' ? styles.connected : styles.disconnected}`}>
        <span className={styles.dot} />
        {sseStatus === 'connected' ? 'Live' : 'Reconnecting'}
      </div>
    </div>
  )
}
```

Create `src/components/ChatPanel/ChatHeader.module.css`:

```css
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-white);
  flex-shrink: 0;
}

.caseId {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--amex-navy);
  letter-spacing: 0.04em;
}

.meta {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
}

.connected {
  background: #f0fdf4;
  color: #16a34a;
}

.disconnected {
  background: #fef9ec;
  color: #ca8a04;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.connected .dot {
  background: var(--green-live);
}

.disconnected .dot {
  background: #ca8a04;
}
```

- [ ] **Step 2: Create TypingIndicator**

Create `src/components/ChatPanel/TypingIndicator.tsx`:

```tsx
import styles from './TypingIndicator.module.css'

export function TypingIndicator() {
  return (
    <div className={styles.wrapper}>
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </div>
  )
}
```

Create `src/components/ChatPanel/TypingIndicator.module.css`:

```css
.wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: 2px 12px 12px 12px;
  width: fit-content;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.dot {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--amex-blue);
  opacity: 0.4;
  animation: bounce 1.2s infinite;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-5px); opacity: 1; }
}
```

- [ ] **Step 3: Create MessageBubble**

Create `src/components/ChatPanel/MessageBubble.tsx`:

```tsx
import { useState } from 'react'
import type { Message } from '../../types'
import styles from './MessageBubble.module.css'

type Props = {
  message: Message
  onRewind: (messageId: string) => void
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ message, onRewind }: Props) {
  const [hovered, setHovered] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const isAgent = message.role === 'agent'

  return (
    <div
      className={`${styles.wrapper} ${isAgent ? styles.agent : styles.reviewer}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowConfirm(false) }}
    >
      <div className={styles.label}>{isAgent ? 'Agent' : 'Reviewer'}</div>
      <div className={styles.row}>
        {isAgent && hovered && (
          <button
            className={styles.rewindBtn}
            onClick={() => setShowConfirm(true)}
            title="Rewind to this point"
          >
            ↩
          </button>
        )}
        <div className={styles.bubble}>{message.text}</div>
        {!isAgent && hovered && (
          <button
            className={styles.rewindBtn}
            onClick={() => setShowConfirm(true)}
            title="Rewind to this point"
          >
            ↩
          </button>
        )}
      </div>
      {showConfirm && (
        <div className={`${styles.popover} ${isAgent ? styles.popoverLeft : styles.popoverRight}`}>
          <p>Rewind to this point? All messages after will be deleted.</p>
          <div className={styles.popoverActions}>
            <button className={styles.confirmBtn} onClick={() => { setShowConfirm(false); onRewind(message.id) }}>
              Confirm
            </button>
            <button className={styles.cancelBtn} onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className={styles.time}>{formatTime(message.timestamp)}</div>
    </div>
  )
}
```

Create `src/components/ChatPanel/MessageBubble.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
  max-width: 72%;
  position: relative;
}

.agent { align-self: flex-start; }
.reviewer { align-self: flex-end; }

.label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.reviewer .label { text-align: right; }

.row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.reviewer .row { flex-direction: row-reverse; }

.bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.55;
}

.agent .bubble {
  background: var(--bg-white);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: 2px 12px 12px 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.reviewer .bubble {
  background: var(--amex-blue);
  color: white;
  border-radius: 12px 12px 2px 12px;
}

.rewindBtn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-muted);
  padding: 2px 4px;
  border-radius: 4px;
  flex-shrink: 0;
  line-height: 1;
}

.rewindBtn:hover { color: var(--amex-blue); background: rgba(1,111,208,0.08); }

.time {
  font-size: 10px;
  color: #bbb;
  margin-top: 4px;
}

.reviewer .time { text-align: right; }

/* Confirmation popover */
.popover {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 10;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  width: 260px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
}

.popoverLeft { left: 0; }
.popoverRight { right: 0; }

.popoverActions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.confirmBtn {
  padding: 5px 12px;
  background: var(--amex-blue);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-body);
}

.cancelBtn {
  padding: 5px 12px;
  background: none;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-body);
}
```

- [ ] **Step 4: Run dev server — verify no compile errors**

```bash
npm run dev
```

Expected: compiles cleanly, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatPanel/ChatHeader.tsx src/components/ChatPanel/ChatHeader.module.css \
  src/components/ChatPanel/TypingIndicator.tsx src/components/ChatPanel/TypingIndicator.module.css \
  src/components/ChatPanel/MessageBubble.tsx src/components/ChatPanel/MessageBubble.module.css
git commit -m "feat: add ChatHeader, TypingIndicator, and MessageBubble components"
```

---

## Task 6: ChatPanel — MessageList, InputBar, and ChatPanel shell

**Files:**
- Create: `src/components/ChatPanel/MessageList.tsx`, `MessageList.module.css`, `src/components/ChatPanel/InputBar.tsx`, `InputBar.module.css`, `src/components/ChatPanel/ChatPanel.tsx`, `ChatPanel.module.css`

- [ ] **Step 1: Create MessageList**

Create `src/components/ChatPanel/MessageList.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { Message } from '../../types'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import styles from './MessageList.module.css'

type Props = {
  messages: Message[]
  showTyping: boolean
  onRewind: (messageId: string) => void
}

export function MessageList({ messages, showTyping, onRewind }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showTyping])

  return (
    <div className={styles.list}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onRewind={onRewind} />
      ))}
      {showTyping && (
        <div className={styles.typingRow}>
          <div className={styles.typingLabel}>Agent</div>
          <TypingIndicator />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
```

Create `src/components/ChatPanel/MessageList.module.css`:

```css
.list {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--bg-app);
}

.typingRow {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
}

.typingLabel {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 4px;
}
```

- [ ] **Step 2: Create InputBar**

Create `src/components/ChatPanel/InputBar.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react'
import styles from './InputBar.module.css'

type Props = {
  onSend: (text: string) => void
  disabled?: boolean
}

export function InputBar({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.inputWrap}>
        <div className={styles.inputLabel}>Reviewer input</div>
        <textarea
          className={styles.textarea}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about this case…"
          disabled={disabled}
        />
      </div>
      <button className={styles.sendBtn} onClick={handleSend} disabled={disabled || !value.trim()}>
        Send
      </button>
    </div>
  )
}
```

Create `src/components/ChatPanel/InputBar.module.css`:

```css
.bar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-white);
  flex-shrink: 0;
}

.inputWrap { flex: 1; }

.inputLabel {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-app);
  resize: none;
  outline: none;
  line-height: 1.5;
  transition: border-color 0.15s;
}

.textarea:focus { border-color: var(--amex-blue); background: var(--bg-white); }
.textarea:disabled { opacity: 0.5; cursor: not-allowed; }

.sendBtn {
  padding: 10px 20px;
  background: var(--amex-blue);
  color: white;
  border: none;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.02em;
  white-space: nowrap;
  transition: opacity 0.15s;
}

.sendBtn:disabled { opacity: 0.4; cursor: not-allowed; }
.sendBtn:not(:disabled):hover { opacity: 0.88; }
```

- [ ] **Step 3: Create ChatPanel**

Create `src/components/ChatPanel/ChatPanel.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { useStore } from '../../store'
import { useSSE } from '../../hooks/useSSE'
import { postMessage, postRewind } from '../../api'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import styles from './ChatPanel.module.css'
import { crypto } from './utils'

export function ChatPanel() {
  const activeCase = useStore((s) => s.activeCase)
  const sseStatus = useStore((s) => s.sseStatus)
  const threads = useStore((s) => s.threads)
  const appendMessage = useStore((s) => s.appendMessage)
  const rewindThread = useStore((s) => s.rewindThread)

  const [showTyping, setShowTyping] = useState(false)

  useSSE(activeCase)

  // Hide typing indicator when a new agent message arrives
  const messages = activeCase ? (threads[activeCase] ?? []) : []
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'agent' && showTyping) {
    setShowTyping(false)
  }

  const handleSend = useCallback(async (text: string) => {
    if (!activeCase) return
    const msg = { id: crypto.randomUUID(), role: 'reviewer' as const, text, timestamp: Date.now() }
    appendMessage(activeCase, msg)
    setShowTyping(true)
    try {
      await postMessage(activeCase, text)
    } catch (e) {
      console.error('Failed to send message', e)
      setShowTyping(false)
    }
  }, [activeCase, appendMessage])

  const handleRewind = useCallback(async (messageId: string) => {
    if (!activeCase) return
    try {
      await postRewind(activeCase, messageId)
      rewindThread(activeCase, messageId)
      setShowTyping(false)
    } catch (e) {
      console.error('Failed to rewind', e)
    }
  }, [activeCase, rewindThread])

  if (!activeCase) {
    return (
      <div className={styles.empty}>
        <p>Select a case to begin review</p>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <ChatHeader caseId={activeCase} sseStatus={sseStatus} />
      <MessageList messages={messages} showTyping={showTyping} onRewind={handleRewind} />
      <InputBar onSend={handleSend} />
    </div>
  )
}
```

Create `src/components/ChatPanel/utils.ts`:

```ts
// Thin wrapper so we can mock crypto.randomUUID in tests
export const crypto = {
  randomUUID: () => globalThis.crypto.randomUUID(),
}
```

Create `src/components/ChatPanel/ChatPanel.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 14px;
}
```

- [ ] **Step 4: Wire ChatPanel into App.tsx**

Replace `src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { useStore } from './store'
import { fetchCaseList } from './api'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ChatPanel } from './components/ChatPanel/ChatPanel'
import './index.css'

function App() {
  const caseList = useStore((s) => s.caseList)
  const activeCase = useStore((s) => s.activeCase)
  const unread = useStore((s) => s.unread)
  const setCaseList = useStore((s) => s.setCaseList)
  const setActiveCase = useStore((s) => s.setActiveCase)

  useEffect(() => {
    fetchCaseList().then(setCaseList).catch(console.error)
  }, [setCaseList])

  const consumerCases = caseList.filter((id) => id.startsWith('C-'))
  const commercialCases = caseList.filter((id) => id.startsWith('M-'))

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        consumerCases={consumerCases}
        commercialCases={commercialCases}
        activeCase={activeCase}
        unread={unread}
        onSelect={setActiveCase}
      />
      <ChatPanel />
    </div>
  )
}

export default App
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Run dev server — full visual verification**

```bash
npm run dev
```

Manually verify:
- Navy sidebar with brand header renders
- "Select a case to begin review" placeholder shows in right panel
- No TypeScript or console errors

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatPanel/ src/App.tsx
git commit -m "feat: add MessageList, InputBar, ChatPanel — full UI wired to store and SSE"
```

---

## Task 7: Mock Backend (Dev-Only)

> Lets you develop and test the full UI without the real agentic backend.

**Files:**
- Create: `src/mockServer.ts`

- [ ] **Step 1: Create mock server using Vite's proxy dev middleware**

Add to `vite.config.ts` (server section):

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
```

- [ ] **Step 2: Create a minimal Express mock server**

```bash
npm install --save-dev express cors
```

Create `src/mockServer.ts` (run separately with `npx tsx src/mockServer.ts`):

```ts
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const CASES = ['C-7891', 'C-4523', 'C-2847', 'M-1892', 'M-5671']

app.get('/api/cases', (_req, res) => {
  res.json(CASES)
})

// SSE: push a mock agent greeting after 1s, then periodic messages
app.get('/api/cases/:id/stream', (req, res) => {
  const { id } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (text: string) => {
    const msg = { id: crypto.randomUUID(), role: 'agent', text, timestamp: Date.now() }
    res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)
  }

  setTimeout(() => send(`I'm reviewing case ${id}. How can I help?`), 1000)

  const timer = setInterval(() => {
    send(`[${new Date().toLocaleTimeString()}] Agent is monitoring case ${id}...`)
  }, 15000)

  req.on('close', () => clearInterval(timer))
})

app.post('/api/cases/:id/message', (req, res) => {
  console.log(`[${req.params.id}] Reviewer: ${req.body.text}`)
  res.sendStatus(204)
})

app.post('/api/cases/:id/rewind', (req, res) => {
  console.log(`[${req.params.id}] Rewind to: ${req.body.messageId}`)
  res.sendStatus(204)
})

app.listen(3001, () => console.log('Mock server on http://localhost:3001'))
```

- [ ] **Step 3: Install tsx for running the mock server**

```bash
npm install --save-dev tsx
```

Add to `package.json` scripts:
```json
"mock": "tsx src/mockServer.ts"
```

- [ ] **Step 4: Test full flow**

In terminal 1:
```bash
npm run mock
```

In terminal 2:
```bash
npm run dev
```

Expected:
- Sidebar shows 5 case IDs (3 Consumer, 2 Commercial)
- Clicking a case opens chat, agent greeting appears after ~1s
- Typing a message and pressing Enter sends it (204 from mock)
- Hovering a message shows ↩ rewind button
- Clicking rewind, confirming → thread truncates, mock logs rewind

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/mockServer.ts package.json
git commit -m "feat: add dev mock server for full E2E UI testing without real backend"
```

---

## Self-Review

**Spec coverage check:**
- [x] Left panel: Consumer / Commercial case list → Tasks 4
- [x] Right panel: chat per case → Tasks 5, 6
- [x] Agent async push (SSE) → Task 3 (useSSE), Task 6 (ChatPanel)
- [x] Reviewer HTTP input → Task 6 (InputBar + postMessage)
- [x] Zustand + localStorage persistence → Task 2
- [x] Rewind UX + API call + thread truncation → Task 6 (MessageBubble + ChatPanel.handleRewind)
- [x] Amex blue visual theme → Tasks 4, 5, 6 (CSS variables in index.css)
- [x] Typing indicator shown after reviewer sends → Task 6
- [x] Typing indicator hidden on agent message → Task 6
- [x] SSE status badge (Live / Reconnecting) → Task 5 (ChatHeader)
- [x] Unread dot on case item → Task 4 (CaseItem)

**Type consistency check:**
- `Message` defined in `types.ts`, used consistently across store, useSSE, MessageBubble, ChatPanel
- `SseStatus` used in types.ts, store.ts, ChatHeader.tsx
- `rewindThread(caseId, messageId)` matches store definition and ChatPanel usage
- `appendMessage(caseId, msg)` matches store definition and useSSE/ChatPanel usage

**Placeholder scan:** No TBDs found.
