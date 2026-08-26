import { useCallback, useEffect, useState } from 'react'

/**
 * The reviewer's current text selection, when it falls inside `ref`.
 *
 * Sentence-level pinning is what the design's pinned insights actually are —
 * one claim, not a whole answer — and an answer's sentences have no markup to
 * hang a per-item control off, unlike the report's bullets. So the selection
 * itself is the target: highlight a sentence, pin what you highlighted.
 *
 * Listens on `selectionchange` at the document rather than on mouseup, so a
 * keyboard selection (shift+arrows) works the same as a drag.
 */
export function useTextSelection(ref: React.RefObject<HTMLElement | null>) {
  const [text, setText] = useState('')

  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection()
      const root = ref.current
      if (!sel || sel.isCollapsed || !root) { setText(''); return }
      // Only claim the selection when it is wholly inside our element —
      // otherwise a drag that starts in the answer and ends in the trace
      // would pin text the answer never contained.
      const anchorIn = sel.anchorNode && root.contains(sel.anchorNode)
      const focusIn = sel.focusNode && root.contains(sel.focusNode)
      if (!anchorIn || !focusIn) { setText(''); return }
      setText(sel.toString().replace(/\s+/g, ' ').trim())
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [ref])

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setText('')
  }, [])

  return { text, clear }
}
