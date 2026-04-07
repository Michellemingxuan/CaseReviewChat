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

export function openSSE(caseId: string): EventSource {
  return new EventSource(`${BASE}/cases/${caseId}/stream`)
}
