import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import styles from './InputBar.module.css'

type Props = {
  onSend: (text: string) => void
  disabled?: boolean
  // When the parent wants to populate the textarea (e.g. on rewind),
  // it bumps `key` and sets `text`. We resync value on every key change,
  // even when the text matches what's already in the box.
  prefill?: { text: string; key: number }
}

export function InputBar({ onSend, disabled, prefill }: Props) {
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
          placeholder="Ask a question about this case…"
          disabled={disabled}
        />
      </div>
      <button className={styles.sendBtn} onClick={handleSend} disabled={disabled || !value.trim()}>
        Send
      </button>
    </div>
  )
}
