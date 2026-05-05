import { AppHeader } from './AppHeader'
import { CaseSection } from './CaseSection'
import { useStore } from '../../store'
import { postRewind } from '../../api'
import styles from './Sidebar.module.css'

type Props = {
  consumerCases: string[]
  commercialCases: string[]
  activeCase: string | null
  unread: Set<string>
  onSelect: (id: string) => void
}

export function Sidebar({ consumerCases, commercialCases, activeCase, unread, onSelect }: Props) {
  const clearHistory = useStore((s) => s.clearHistory)
  const threads = useStore((s) => s.threads)

  // Clear-history must reset the SERVER's per-session memory too — the
  // orchestrator's multi-turn input list and the exact-match qa_cache —
  // otherwise a question previously answered in this session would replay
  // its cached answer the next time it's asked. We hit the rewind endpoint
  // (which clears both server-side caches) for every case that has a
  // thread, then clear the front-end state.
  async function handleClearHistory() {
    const caseIds = Object.keys(threads)
    await Promise.all(caseIds.map((id) =>
      postRewind(id, '').catch((err) => {
        console.error(`Failed to clear server cache for case ${id}`, err)
      })
    ))
    clearHistory()
  }

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
      <div className={styles.footer}>
        <button className={styles.clearBtn} onClick={handleClearHistory}>
          Clear History
        </button>
      </div>
    </nav>
  )
}
