import { useState, useCallback, useEffect } from 'react'
import { useStore } from '../../store'
import { useSSE } from '../../hooks/useSSE'
import { postMessage, postRewind } from '../../api'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import styles from './ChatPanel.module.css'

export function ChatPanel() {
  const activeCase = useStore((s) => s.activeCase)
  const sseStatus = useStore((s) => s.sseStatus)
  const threads = useStore((s) => s.threads)
  const appendMessage = useStore((s) => s.appendMessage)
  const rewindThread = useStore((s) => s.rewindThread)

  const [showTyping, setShowTyping] = useState(false)

  useSSE(activeCase)

  const messages = activeCase ? (threads[activeCase] ?? []) : []
  const lastMsg = messages[messages.length - 1]

  // Hide typing indicator when agent message arrives
  useEffect(() => {
    if (lastMsg?.role === 'agent') {
      setShowTyping(false)
    }
  }, [lastMsg])

  const handleSend = useCallback(async (text: string) => {
    if (!activeCase) return
    const msg = {
      id: globalThis.crypto.randomUUID(),
      role: 'reviewer' as const,
      text,
      timestamp: Date.now(),
    }
    appendMessage(activeCase, msg)
    setShowTyping(true)
    try {
      await postMessage(activeCase, text)
    } catch (e) {
      console.error('Failed to send message', e)
      setShowTyping(false)
    }
  }, [activeCase, appendMessage])

  const handleRewind = useCallback(async (messageId: string) => {
    if (!activeCase) return
    try {
      await postRewind(activeCase, messageId)
      rewindThread(activeCase, messageId)
      setShowTyping(false)
    } catch (e) {
      console.error('Failed to rewind', e)
    }
  }, [activeCase, rewindThread])

  if (!activeCase) {
    return (
      <div className={styles.empty}>
        <p>Select a case to begin review</p>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <ChatHeader caseId={activeCase} sseStatus={sseStatus} />
      <MessageList messages={messages} showTyping={showTyping} onRewind={handleRewind} />
      <InputBar onSend={handleSend} />
    </div>
  )
}
