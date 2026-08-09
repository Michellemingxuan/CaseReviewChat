import { useEffect } from 'react'
import { fetchHistory } from '../api'
import { useStore } from '../store'

/** On case open, load the server-authoritative thread. The persisted store
 *  (localStorage) provides an instant first paint; this replaces it with the
 *  server's truth so restarts / other devices show the real conversation.
 *  Errors are ignored — the persisted thread remains as fallback. */
export function useCaseHistory(caseId: string | null): void {
  const setCaseHistory = useStore((s) => s.setCaseHistory)
  useEffect(() => {
    if (!caseId) return
    let cancelled = false
    fetchHistory(caseId)
      .then((messages) => { if (!cancelled) setCaseHistory(caseId, messages) })
      .catch(() => { /* keep persisted thread */ })
    return () => { cancelled = true }
  }, [caseId, setCaseHistory])
}
