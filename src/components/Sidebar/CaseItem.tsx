import styles from './CaseItem.module.css'

type Props = {
  id: string
  isActive: boolean
  hasUnread: boolean
  onClick: (id: string) => void
}

export function CaseItem({ id, isActive, hasUnread, onClick }: Props) {
  return (
    <button
      className={`${styles.item} ${isActive ? styles.active : ''}`}
      onClick={() => onClick(id)}
    >
      <span className={styles.id}>{id}</span>
      {hasUnread && <span className={styles.unreadDot} aria-label="unread messages" />}
    </button>
  )
}
