import type {
  CaseList, CaseOverviewRow, CaseReport, Message, HistoryResponse, Opportunity,
  Pin, PinKind, PinSynthesis, SynthesisMode,
} from './types'
import type { Pillar } from './journey/types'
const BASE = '/api'

export async function fetchCaseList(): Promise<CaseList> {
  const res = await fetch(`${BASE}/cases`)
  if (!res.ok) throw new Error(`fetchCaseList failed: ${res.status}`)
  return res.json()
}

export async function fetchHistory(caseId: string): Promise<Message[]> {
  const res = await fetch(`${BASE}/cases/${caseId}/history`)
  if (!res.ok) throw new Error(`fetchHistory failed: ${res.status}`)
  const data: HistoryResponse = await res.json()
  return data.messages
}

export async function postMessage(caseId: string, text: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`)
}

export async function postRewind(
  caseId: string,
  messageId: string,
  removeTurnIds?: string[],
): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/rewind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, removeTurnIds }),
  })
  if (!res.ok) throw new Error(`postRewind failed: ${res.status}`)
}

/** Interrupt the currently-in-flight turn for this case WITHOUT clearing
 *  session history. Used by the Stop button in the input bar — the user
 *  wants to abort the current LLM round and re-ask, but keep accumulated
 *  context. Unlike `postRewind` (which wipes qa_cache + input_history +
 *  KB), this is the "just stop, leave the rest alone" variant. */
export async function postCancelTurn(caseId: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/cancel-turn`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`postCancelTurn failed: ${res.status}`)
}

export function openSSE(caseId: string): EventSource {
  return new EventSource(`${BASE}/cases/${caseId}/stream`)
}

/** Fetch the curated case report — every section, markdown inline.
 *
 *  One request for the whole report (~75KB on a real case) rather than one
 *  per section: cheaper than ten round trips, and it means switching tabs
 *  is instant instead of showing a spinner each time. */
export async function fetchCaseReport(caseId: string): Promise<CaseReport> {
  const res = await fetch(`${BASE}/cases/${caseId}/report`)
  if (!res.ok) throw new Error(`fetchCaseReport failed: ${res.status}`)
  return res.json()
}

// ── Pins / opportunities ──────────────────────────────────────────────────

export async function fetchPins(caseId: string): Promise<Pin[]> {
  const res = await fetch(`${BASE}/cases/${caseId}/pins`)
  if (!res.ok) throw new Error(`fetchPins failed: ${res.status}`)
  return (await res.json()).pins
}

/** Pin an insight or a figure. Figure pins are idempotent server-side on
 *  (turn, specialist, topic), so "Pin Figures" can be pressed twice without
 *  duplicating cards. */
export async function postPin(
  caseId: string,
  pin: Partial<Pin> & { kind: PinKind },
): Promise<Pin> {
  const res = await fetch(`${BASE}/cases/${caseId}/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pin),
  })
  if (!res.ok) throw new Error(`postPin failed: ${res.status}`)
  return res.json()
}

export async function deletePin(caseId: string, pinId: string): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/pins/${pinId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deletePin failed: ${res.status}`)
}

/** Insert a pin into a report section, or lift it out again with null. */
export async function postPinSection(
  caseId: string, pinId: string, sectionKey: string | null,
): Promise<void> {
  const res = await fetch(`${BASE}/cases/${caseId}/pins/${pinId}/section`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section_key: sectionKey }),
  })
  if (!res.ok) throw new Error(`postPinSection failed: ${res.status}`)
}

export async function fetchOpportunities(caseId: string): Promise<Opportunity[]> {
  const res = await fetch(`${BASE}/cases/${caseId}/opportunities`)
  if (!res.ok) throw new Error(`fetchOpportunities failed: ${res.status}`)
  return (await res.json()).opportunities
}

export async function postOpportunity(
  caseId: string, opp: { title: string; body?: string; pin_ids?: string[] },
): Promise<Opportunity> {
  const res = await fetch(`${BASE}/cases/${caseId}/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opp),
  })
  if (!res.ok) throw new Error(`postOpportunity failed: ${res.status}`)
  return res.json()
}

/** Cases with the two dates a reviewer picks by: report freshness and last
 *  question asked. */
export async function fetchCasesOverview(): Promise<CaseOverviewRow[]> {
  const res = await fetch(`${BASE}/cases/overview`)
  if (!res.ok) throw new Error(`fetchCasesOverview failed: ${res.status}`)
  return (await res.json()).cases
}

/** Synthesise the selected pins. Slow by nature — it is a real model call —
 *  so callers must show progress rather than assuming it returns promptly. */
export async function postSynthesis(
  caseId: string, mode: SynthesisMode, pinIds: string[],
): Promise<PinSynthesis> {
  const res = await fetch(`${BASE}/cases/${caseId}/synthesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, pin_ids: pinIds }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail?.error ?? `synthesis failed: ${res.status}`)
  }
  return res.json()
}

/** Available pillars and the one this server is running.
 *
 *  `active` is fixed at boot (`PILLAR` env), so the UI lists the others as
 *  unavailable rather than offering a switch that cannot take effect. */
export async function fetchPillars(): Promise<{ active: string; pillars: Pillar[] }> {
  const res = await fetch(`${BASE}/pillars`)
  if (!res.ok) throw new Error(`fetchPillars failed: ${res.status}`)
  return res.json()
}
