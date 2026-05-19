import type { CaseList } from './types'
const BASE = '/api'

export async function fetchCaseList(): Promise<CaseList> {
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
