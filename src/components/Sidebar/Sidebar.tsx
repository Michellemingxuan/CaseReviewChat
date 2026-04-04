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
