import { useEffect, useRef } from 'react'
import type { Message } from '../../types'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import styles from './MessageList.module.css'

type Props = {
  messages: Message[]
  showTyping: boolean
  onRewind: (messageId: string) => void
}

export function MessageList({ messages, showTyping, onRewind }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showTyping])

  return (
    <div className={styles.list}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onRewind={onRewind} />
      ))}
      {showTyping && (
        <div className={styles.typingRow}>
          <div className={styles.typingLabel}>Agent</div>
          <TypingIndicator />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
