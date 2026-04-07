import { useStore } from '../../store'
import type { SseStatus } from '../../types'
import styles from './ChatHeader.module.css'

type Props = {
  caseId: string
  sseStatus: SseStatus
}

export function ChatHeader({ caseId, sseStatus }: Props) {
  const caseList = useStore((s) => s.caseList)
  const segment = caseList.consumer.includes(caseId) ? 'Consumer' : 'Commercial'

  return (
    <div className={styles.header}>
      <div>
        <div className={styles.caseId}>{caseId}</div>
        <div className={styles.meta}>
          {segment} · active session
        </div>
      </div>
      <div className={`${styles.badge} ${sseStatus === 'connected' ? styles.connected : styles.disconnected}`}>
        <span className={styles.dot} />
        {sseStatus === 'connected' ? 'Live' : 'Reconnecting'}
      </div>
    </div>
  )
}
