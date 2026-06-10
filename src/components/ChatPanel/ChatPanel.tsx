import { useState, useCallback, useEffect } from 'react'
import { useStore } from '../../store'
import { useSSE } from '../../hooks/useSSE'
import { postMessage, postRewind, postCancelTurn } from '../../api'
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
  const patchTurn = useStore((s) => s.patchTurn)
  // We read the latest turns directly (not via subscription) inside
  // `handleStop` so the callback doesn't churn re-renders on every
  // SSE event during streaming.
  const turnsMap = useStore((s) => s.turns)

  // Whether a turn is in flight for this case. Boolean selector → re-renders
  // only when streaming status flips (start/end), not on every SSE event.
  // Drives the "agent thinking…" indicator FROM THE STORE so it survives a
  // hard-refresh: replay-on-reconnect restores the streaming turn, and the
  // indicator comes back with it (the local `showTyping` flag resets on
  // reload). Combined below as `showTyping || hasStreamingTurn`.
  const hasStreamingTurn = useStore((s) =>
    activeCase ? (s.turns[activeCase] ?? []).some((t) => t.status === 'streaming') : false
  )

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
      // Compute which turns will be removed BEFORE calling the server,
      // so we can tell it exactly which trace rows to delete.
      const { text: revText, removedTurnIds } = rewindThread(activeCase, messageId)
      await postRewind(activeCase, messageId, removedTurnIds)
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

  const handleStop = useCallback(async () => {
    if (!activeCase) return
    // Optimistic update: flip the streaming turn to 'error' state with
    // an "interrupted" kind IMMEDIATELY so the orchestration-flow panel
    // stops showing "streaming" the instant the user clicks Stop.
    // Without this, the panel keeps the streaming badge until the
    // backend's `error`+`turn_done` SSE events arrive — and on a
    // safechain backend that can take a few seconds even when
    // cancellation works, or arbitrarily long if it's stuck. The
    // backend events still arrive shortly and refine the error message
    // with the canonical "Interrupted — the answer was stopped…"
    // copy; this just gives instant visual feedback.
    const streamingTurn = (turnsMap[activeCase] ?? []).find(
      (t) => t.status === 'streaming'
    )
    if (streamingTurn) {
      patchTurn(activeCase, streamingTurn.turn_id, {
        status: 'error',
        errorKind: 'interrupted',
        error: 'Stopping the answer…',
        outcome: 'aborted',
      })
    }
    setShowTyping(false)
    try {
      await postCancelTurn(activeCase)
    } catch (e) {
      console.error('Failed to cancel turn', e)
    }
  }, [activeCase, turnsMap, patchTurn])

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
      <InputBar
        onSend={handleSend}
        prefill={prefill}
        streaming={showTyping || hasStreamingTurn}
        onStop={handleStop}
      />
    </div>
  )
}
