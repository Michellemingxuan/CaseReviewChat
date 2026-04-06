import { AppHeader } from './AppHeader'
import { CaseSection } from './CaseSection'
import { useStore } from '../../store'
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
        <button className={styles.clearBtn} onClick={clearHistory}>
          Clear History
        </button>
      </div>
    </nav>
  )
}
