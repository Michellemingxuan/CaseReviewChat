import { AppHeader } from './AppHeader'
import { CaseItem } from './CaseItem'
import { useStore } from '../../store'
import { postRewind } from '../../api'
import styles from './Sidebar.module.css'

type Props = {
  cases: string[]
  activeCase: string | null
  unread: Set<string>
  onSelect: (id: string) => void
}

// Clear-history must reset the SERVER's per-session memory too — the
// orchestrator's multi-turn input list and the exact-match qa_cache —
// otherwise a question previously answered in this session would replay
// its cached answer the next time it's asked. We hit the rewind endpoint
// (which clears both server-side caches) for the active case only, then
// clear that case's front-end state.
export async function handleClearHistoryForActive() {
  const { activeCase, clearCaseHistory } = useStore.getState()
  if (!activeCase) return
  await postRewind(activeCase, '').catch((err) =>
    console.error(`Failed to clear server cache for case ${activeCase}`, err))
  clearCaseHistory(activeCase)
}

export function Sidebar({ cases, activeCase, unread, onSelect }: Props) {
  return (
    <nav className={styles.sidebar}>
      <AppHeader />
      <div className={styles.list}>
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
      <div className={styles.footer}>
        <button className={styles.clearBtn} onClick={handleClearHistoryForActive}>
          Clear this case
        </button>
      </div>
    </nav>
  )
}
