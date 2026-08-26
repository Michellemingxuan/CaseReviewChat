import { AppHeader } from './AppHeader'
import { CaseItem } from './CaseItem'
import { useStore } from '../../store'
import { clearCaseHistory } from '../../lib/caseHistory'
import styles from './Sidebar.module.css'

type Props = {
  cases: string[]
  activeCase: string | null
  unread: Set<string>
  onSelect: (id: string) => void
}

/** Clear the active case, server side and client side. Thin wrapper over the
 *  shared implementation, which lives in `lib/` so it outlives this
 *  classic-only component. */
export async function handleClearHistoryForActive() {
  await clearCaseHistory(useStore.getState().activeCase)
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
