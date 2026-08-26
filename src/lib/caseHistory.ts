import { postRewind } from '../api'
import { useStore } from '../store'

/**
 * Clear one case's conversation — server side and client side.
 *
 * BOTH halves are required and the order matters. `postRewind(caseId, '')`
 * clears the server's `qa_cache` and specialist KB; without it a question
 * asked again would replay its cached answer, so a "cleared" case is not
 * actually clear. `clearCaseHistory` then drops the local thread, turns and
 * unread flag for that case only.
 *
 * Lives here rather than in a component because both shells need it and the
 * classic Sidebar is scheduled for deletion — this is the part that must
 * outlive it.
 */
export async function clearCaseHistory(caseId: string | null): Promise<void> {
  if (!caseId) return
  // Server first: if it fails we still clear locally, because leaving the
  // reviewer looking at a thread they asked to delete is worse than a stale
  // server cache. The error is logged, not swallowed silently.
  await postRewind(caseId, '').catch((err) =>
    console.error(`Failed to clear server cache for case ${caseId}`, err))
  useStore.getState().clearCaseHistory(caseId)
}
