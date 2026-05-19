import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import styles from './InputBar.module.css'

type Props = {
  onSend: (text: string) => void
  disabled?: boolean
  /** True when a turn is currently in flight. While streaming, the
   *  Send button becomes a Stop button so the user can interrupt the
   *  agent mid-answer and re-ask. The textarea stays enabled so the
   *  user can pre-type their next question. */
  streaming?: boolean
  /** Called when the user clicks Stop. Should hit the backend's
   *  `/cancel-turn` endpoint. */
  onStop?: () => void
  // When the parent wants to populate the textarea (e.g. on rewind),
  // it bumps `key` and sets `text`. We resync value on every key change,
  // even when the text matches what's already in the box.
  prefill?: { text: string; key: number }
}

export function InputBar({ onSend, disabled, streaming, onStop, prefill }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const lastPrefillKey = useRef<number | null>(null)

  // Apply prefill from parent (e.g. rewind populates the reviewer's prior
  // question for editing). Only fires when `prefill.key` changes.
  useEffect(() => {
    if (!prefill) return
    if (lastPrefillKey.current === prefill.key) return
    lastPrefillKey.current = prefill.key
    setValue(prefill.text)
    // Focus + place caret at end so the user can immediately edit.
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(prefill.text.length, prefill.text.length)
      }
    })
  }, [prefill])

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // While streaming, Enter is a no-op — the user must click Stop
      // explicitly to abort. Avoids the foot-gun where a fast typer
      // presses Enter expecting "send my next question" and instead
      // cancels the in-flight one. The Stop button is the deliberate
      // interruption affordance.
      if (streaming) return
      handleSend()
    }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.inputWrap}>
        <div className={styles.inputLabel}>Reviewer input</div>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            streaming
              ? 'Answering — press Stop to interrupt and re-ask…'
              : 'Ask a question about this case…'
          }
          // Textarea stays enabled while streaming so the user can
          // pre-type their next question. Only the Send/Stop button
          // changes behavior. `disabled` from parent still gates
          // unrelated states (no active case, etc.).
          disabled={disabled}
        />
      </div>
      {streaming ? (
        <button
          className={`${styles.sendBtn} ${styles.stopBtn ?? ''}`}
          onClick={onStop}
          // Don't let `disabled` prop hide Stop — even if the parent
          // says "disabled" for other reasons (rare), the user must
          // always be able to interrupt a runaway turn.
          title="Stop the current answer. Your typed text stays in the box."
          aria-label="Stop"
        >
          ■ Stop
        </button>
      ) : (
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      )}
    </div>
  )
}
