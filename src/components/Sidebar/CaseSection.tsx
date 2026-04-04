import { CaseItem } from './CaseItem'
import styles from './CaseSection.module.css'

type Props = {
  label: string
  cases: string[]
  activeCase: string | null
  unread: Set<string>
  onSelect: (id: string) => void
}

export function CaseSection({ label, cases, activeCase, unread, onSelect }: Props) {
  if (cases.length === 0) return null
  return (
    <div>
      <div className={styles.label}>{label}</div>
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
  )
}
