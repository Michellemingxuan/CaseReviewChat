import type { SseStatus } from '../../types'
import styles from './ChatHeader.module.css'

type Props = {
  caseId: string
  sseStatus: SseStatus
}

export function ChatHeader({ caseId, sseStatus }: Props) {
  return (
    <div className={styles.header}>
      <div>
        <div className={styles.caseId}>{caseId}</div>
        <div className={styles.meta}>
          {caseId.startsWith('C-') ? 'Consumer' : 'Commercial'} · active session
        </div>
      </div>
      <div className={`${styles.badge} ${sseStatus === 'connected' ? styles.connected : styles.disconnected}`}>
        <span className={styles.dot} />
        {sseStatus === 'connected' ? 'Live' : 'Reconnecting'}
      </div>
    </div>
  )
}
