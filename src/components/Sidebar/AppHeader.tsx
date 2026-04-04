import styles from './AppHeader.module.css'

export function AppHeader() {
  return (
    <div className={styles.header}>
      <div className={styles.badge}>
        <span className={styles.badgeDot} />
        <span className={styles.badgeText}>Agentic System</span>
      </div>
      <div className={styles.brand}>Case Review</div>
    </div>
  )
}
