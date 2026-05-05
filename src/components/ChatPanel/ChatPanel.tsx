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
  const rewindThread = useStore((s) => s.rewindThread)
  const activeTurnIdMap = useStore((s) => s.activeTurnId)
  const setActiveTurn = useStore((s) => s.setActiveTurn)
  const appendMessage = useStore((s) => s.appendMessage)

  const [showTyping, setShowTyping] = useState(false)
  // `prefill` is the reviewer text the InputBar should populate after a
  // rewind. Bumping `key` triggers the InputBar's effect even when the same
  // text is rewound twice in a row.
  const [prefill, setPrefill] = useState<{ text: string; key: number }>({ text: '', key: 0 })

  useSSE(activeCase)

  const messages = activeCase ? (threads[activeCase] ?? []) : []
  const lastMsg = messages[messages.length - 1]
  const activeTurnId = activeCase ? (activeTurnIdMap[activeCase] ?? null) : null

  // Hide typing indicator when any new agent message arrives via SSE
  useEffect(() => {
    if (lastMsg?.role === 'agent') {
      setShowTyping(false)
    }
  }, [lastMsg])

  const handleSend = useCallback(async (text: string) => {
    if (!activeCase) return
    // Optimistically append the reviewer's question so it appears immediately
    // — independent of the server's `reviewer_message` SSE echo, which can
    // be delayed, dropped, or fire before subscribers reconnect. The SSE
    // echo is deduped in useSSE.ts (text+role+recency match).
    appendMessage(activeCase, {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'reviewer',
      text,
      timestamp: Date.now(),
    })
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
      // rewindThread now drops the owning reviewer message + everything
      // after, and returns that reviewer's text so we can put it back in
      // the input box for editing.
      const revText = rewindThread(activeCase, messageId)
      setShowTyping(false)
      if (revText) setPrefill({ text: revText, key: Date.now() })
    } catch (e) {
      console.error('Failed to rewind', e)
    }
  }, [activeCase, rewindThread])

  const handleSelectTurn = useCallback((turnId: string) => {
    if (!activeCase) return
    setActiveTurn(activeCase, turnId)
  }, [activeCase, setActiveTurn])

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
      <MessageList
        messages={messages}
        showTyping={showTyping}
        onRewind={handleRewind}
        onSelectTurn={handleSelectTurn}
        activeTurnId={activeTurnId}
      />
      <InputBar onSend={handleSend} prefill={prefill} />
    </div>
  )
}
