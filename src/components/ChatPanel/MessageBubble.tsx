import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import type { Message } from '../../types'
import styles from './MessageBubble.module.css'

type Props = {
  message: Message
  onRewind: (messageId: string) => void
  onSelectTurn?: (turnId: string) => void
  isActive?: boolean
}

function formatTime(timestamp?: number): string {
  if (!timestamp || Number.isNaN(timestamp)) return ''
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ message, onRewind, onSelectTurn, isActive }: Props) {
  const [hovered, setHovered] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const isAgent = message.role === 'agent'
  const clickable = isAgent && !!message.turn_id && !!onSelectTurn

  const handleBubbleClick = () => {
    if (!clickable) return
    onSelectTurn!(message.turn_id!)
  }

  return (
    <div
      className={`${styles.wrapper} ${isAgent ? styles.agent : styles.reviewer} ${isActive ? styles.active : ''}`}
      data-turn-id={message.turn_id || undefined}
      data-role={message.role}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.label}>
        {isAgent ? 'Agent' : 'Reviewer'}
        {clickable && <span className={styles.hint}>· click to inspect</span>}
      </div>
      <div className={styles.row}>
        <div
          className={`${styles.bubble} ${clickable ? styles.clickable : ''}`}
          onClick={handleBubbleClick}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onKeyDown={(e) => {
            if (clickable && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              handleBubbleClick()
            }
          }}
        >
          {/* rehype-raw allows the markdown renderer to parse inline HTML
              (e.g. `<table>` / `<b>` the orchestrator sometimes emits in
              FinalAnswer.answer instead of GFM-table syntax). Without it
              tags render as literal escaped text — see screenshot in
              the case 366 thread. Agent messages are server-authored and
              never reflect untrusted reviewer input, so the XSS surface
              is the same as before. */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {message.text}
          </ReactMarkdown>
        </div>
        {hovered && (
          <button
            className={styles.rewindBtn}
            onClick={(e) => { e.stopPropagation(); setShowConfirm(true) }}
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
              onClick={(e) => { e.stopPropagation(); setShowConfirm(false); onRewind(message.id) }}
            >
              Confirm
            </button>
            <button
              className={styles.cancelBtn}
              onClick={(e) => { e.stopPropagation(); setShowConfirm(false) }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className={styles.time}>{formatTime(message.timestamp)}</div>
    </div>
  )
}
