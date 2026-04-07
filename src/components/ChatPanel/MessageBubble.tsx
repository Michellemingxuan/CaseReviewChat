import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message } from '../../types'
import styles from './MessageBubble.module.css'

type Props = {
  message: Message
  onRewind: (messageId: string) => void
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ message, onRewind }: Props) {
  const [hovered, setHovered] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const isAgent = message.role === 'agent'

  return (
    <div
      className={`${styles.wrapper} ${isAgent ? styles.agent : styles.reviewer}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.label}>{isAgent ? 'Agent' : 'Reviewer'}</div>
      <div className={styles.row}>
        <div className={styles.bubble}>
          <ReactMarkdown>{message.text}</ReactMarkdown>
        </div>
        {hovered && (
          <button
            className={styles.rewindBtn}
            onClick={() => setShowConfirm(true)}
            title="Rewind to this point"
          >
            ↩
          </button>
        )}
      </div>
      {showConfirm && (
        <div className={`${styles.popover} ${isAgent ? styles.popoverLeft : styles.popoverRight}`}>
          <p>Rewind to this point? All messages after will be deleted.</p>
          <div className={styles.popoverActions}>
            <button
              className={styles.confirmBtn}
              onClick={() => { setShowConfirm(false); onRewind(message.id) }}
            >
              Confirm
            </button>
            <button className={styles.cancelBtn} onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className={styles.time}>{formatTime(message.timestamp)}</div>
    </div>
  )
}
