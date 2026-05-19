import { useStore } from '../../store'
import type { SseStatus } from '../../types'
import styles from './ChatHeader.module.css'

type Props = {
  caseId: string
  sseStatus: SseStatus
}

export function ChatHeader({ caseId, sseStatus }: Props) {
  const caseList = useStore((s) => s.caseList)
  const forceReconnect = useStore((s) => s.forceReconnect)
  const segment = caseList.consumer.includes(caseId) ? 'Consumer' : 'Commercial'
  const connected = sseStatus === 'connected'

  return (
    <div className={styles.header}>
      <div>
        <div className={styles.caseId}>{caseId}</div>
        <div className={styles.meta}>
          {segment} · active session
        </div>
      </div>
      {/* When `connected`, the badge is a passive status pill. When the
          connection is down, it becomes a one-click recovery button —
          alternative to hard-refreshing the page (which loses the SSE
          the same way but ALSO wastes the page load + cold cache).
          Tooltip explains the action so screen-reader / keyboard users
          have parity with the visual affordance. */}
      {connected ? (
        <div
          className={`${styles.badge} ${styles.connected}`}
          title="Live connection to the agentic backend — events streaming."
          aria-live="polite"
        >
          <span className={styles.dot} />
          Live
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.badge} ${styles.disconnected}`}
          onClick={forceReconnect}
          title="Connection lost. Click to reconnect — no need to refresh the page."
          aria-live="polite"
        >
          <span className={styles.dot} />
          Reconnect
        </button>
      )}
    </div>
  )
}
