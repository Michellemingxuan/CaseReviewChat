import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useSSE } from '../../hooks/useSSE'
import { useCaseHistory } from '../../hooks/useCaseHistory'
import { postMessage, postRewind, postCancelTurn } from '../../api'
import { usePins } from '../usePins'
import { clearCaseHistory } from '../../lib/caseHistory'
import { TurnCard } from './TurnCard'
import { buildTurnViews, type TurnView } from './turns'
import s from './AssistantPanel.module.css'

/** Follow-up prompts from the design's chip row. */
const SUGGESTIONS = [
  'Which part of the report shall I pay attention to?',
  'What transactions are connected?',
  'What evidence supports it?',
  'What evidence contradicts it?',
]

/**
 * The Case Review Assistant column.
 *
 * Replaces the classic `ChatPanel` for the journey shell. The send / rewind /
 * stop logic is carried over from it — those paths are load-bearing (the
 * optimistic reviewer bubble, computing removed turn ids BEFORE calling the
 * server, the optimistic 'interrupted' patch on Stop) and are reproduced here
 * rather than reinvented. What changes is the presentation: message bubbles
 * become turn cards that own their own figures and pin actions.
 */
export function AssistantPanel({ caseId, ask }: {
  caseId: string | null
  /** A question pushed in from elsewhere (the report's "More details about
   *  …"). Bumping `key` re-fires even when the text repeats. */
  ask?: { text: string; key: number } | null
}) {
  const sseStatus = useStore((st) => st.sseStatus)
  const threads = useStore((st) => st.threads)
  const turnsMap = useStore((st) => st.turns)
  const rewindThread = useStore((st) => st.rewindThread)
  const appendMessage = useStore((st) => st.appendMessage)
  const patchTurn = useStore((st) => st.patchTurn)
  const setActiveTurn = useStore((st) => st.setActiveTurn)

  const hasStreamingTurn = useStore((st) =>
    caseId ? (st.turns[caseId] ?? []).some((t) => t.status === 'streaming') : false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [openTurn, setOpenTurn] = useState<number | null>(null)
  // Two-step confirm. Clearing wipes the server's qa_cache as well as the
  // local thread and cannot be undone, so it should not be one stray click.
  const [confirmClear, setConfirmClear] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useSSE(caseId)
  useCaseHistory(caseId)
  const { pins, pinInsight, pinFigures, busy: pinBusy } = usePins(caseId)

  const views = useMemo(
    () => buildTurnViews(
      caseId ? (threads[caseId] ?? []) : [],
      caseId ? (turnsMap[caseId] ?? []) : [],
    ),
    [caseId, threads, turnsMap],
  )

  // Default to the newest turn open, matching the design (turns 1–2 collapsed,
  // 3–4 open). `null` means "no explicit choice yet", so a new turn arriving
  // takes focus, while an explicit collapse survives the next render.
  const lastIndex = views.length > 0 ? views[views.length - 1].index : null
  const effectiveOpen = openTurn ?? lastIndex

  useEffect(() => { setOpenTurn(null); setConfirmClear(false) }, [caseId])

  // A question handed over from the report. Put it in the box rather than
  // sending it: the reviewer should see and be able to edit what will be
  // asked on their behalf before it costs a turn.
  useEffect(() => {
    if (!ask?.text) return
    setDraft(ask.text)
    inputRef.current?.focus()
  }, [ask?.key, ask?.text])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [views.length, hasStreamingTurn])

  // Autosize the composer. Height is reset to `auto` first so the box can
  // SHRINK again when text is deleted, not just grow.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  // Keep the reasoning-trace panel pointed at whichever turn is open, so the
  // trace on the right always explains the answer being read on the left.
  useEffect(() => {
    if (!caseId) return
    const v = views.find((x) => x.index === effectiveOpen)
    if (v?.turnId) setActiveTurn(caseId, v.turnId)
  }, [caseId, effectiveOpen, views, setActiveTurn])

  const pinnedFigureTopics = useMemo(() => {
    const byTurn = new Map<string, Set<string>>()
    for (const p of pins) {
      if (p.kind !== 'figure' || !p.turn_id || !p.topic) continue
      if (!byTurn.has(p.turn_id)) byTurn.set(p.turn_id, new Set())
      byTurn.get(p.turn_id)!.add(p.topic)
    }
    return byTurn
  }, [pins])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || !caseId) return
    setDraft('')
    // Optimistic reviewer bubble — independent of the server's
    // `reviewer_message` echo, which can be delayed or dropped. useSSE dedupes
    // the echo on text+role+recency.
    appendMessage(caseId, {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'reviewer', text: q, timestamp: Date.now(),
    })
    setSending(true)
    setOpenTurn(null)   // follow the new turn
    try {
      await postMessage(caseId, q)
    } catch (e) {
      console.error('Failed to send message', e)
    } finally {
      setSending(false)
    }
  }, [caseId, appendMessage])

  const handleRewind = useCallback(async (view: TurnView) => {
    if (!caseId || !view.questionMessageId) return
    try {
      // Compute removed turn ids BEFORE calling the server so it can drop the
      // matching trace rows too.
      const { text, removedTurnIds } = rewindThread(caseId, view.questionMessageId)
      await postRewind(caseId, view.questionMessageId, removedTurnIds)
      if (text) setDraft(text)
    } catch (e) {
      console.error('Failed to rewind', e)
    }
  }, [caseId, rewindThread])

  const handleStop = useCallback(async () => {
    if (!caseId) return
    // Flip the streaming turn immediately: the backend's error + turn_done
    // events can lag seconds behind a cancel, and the panel should not keep
    // claiming to be working after the user pressed Stop.
    const streaming = (turnsMap[caseId] ?? []).find((t) => t.status === 'streaming')
    if (streaming) {
      patchTurn(caseId, streaming.turn_id, {
        status: 'error', errorKind: 'interrupted',
        error: 'Stopping the answer…', outcome: 'aborted',
      })
    }
    try {
      await postCancelTurn(caseId)
    } catch (e) {
      console.error('Failed to cancel turn', e)
    }
  }, [caseId, turnsMap, patchTurn])

  if (!caseId) {
    return <div className={s.empty}><p>Select a case to begin review.</p></div>
  }

  const streaming = sending || hasStreamingTurn

  return (
    <section className={s.panel} aria-label="Case review assistant">
      <div className={s.head}>
        <span className={s.headAccent} aria-hidden="true" />
        <span className={`jEyebrow ${s.headTitle}`}>Case Review Assistant</span>
        <span className={`${s.live} ${sseStatus === 'connected' ? s.liveOn : s.liveOff}`}>
          <span className={s.dot} aria-hidden="true" />
          {sseStatus === 'connected' ? 'Live' : 'Reconnecting'}
        </span>
      </div>
      <div className={s.subhead}>
        <span>
          Session · {caseId} · {views.length} turn{views.length === 1 ? '' : 's'}
        </span>
        {views.length > 0 && (
          confirmClear ? (
            <span className={s.confirmRow}>
              <span className={s.confirmText}>Clear this case?</span>
              <button
                type="button"
                className={s.confirmYes}
                onClick={async () => {
                  setConfirmClear(false)
                  await clearCaseHistory(caseId)
                }}
              >
                Clear
              </button>
              <button type="button" className={s.confirmNo}
                      onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={s.clearLink}
              onClick={() => setConfirmClear(true)}
              title="Delete this case's conversation, here and on the server"
            >
              Clear
            </button>
          )
        )}
      </div>

      <div className={s.turns}>
        {views.length === 0 && (
          <p className={s.placeholder}>No questions yet. Ask one below.</p>
        )}
        {views.map((v) => (
          <TurnCard
            key={v.turnId ?? `local-${v.index}`}
            view={v}
            expanded={v.index === effectiveOpen}
            onToggle={() => setOpenTurn(v.index === effectiveOpen ? -1 : v.index)}
            onPinInsight={pinInsight}
            onPinFigures={pinFigures}
            onRewind={handleRewind}
            pinnedFigureTopics={
              (v.turnId && pinnedFigureTopics.get(v.turnId)) || new Set<string>()
            }
            busy={pinBusy}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className={s.foot}>
        <div className={s.chips}>
          {SUGGESTIONS.map((q) => (
            <button
              key={q} type="button" className={s.chip}
              disabled={streaming} onClick={() => send(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className={s.inputRow}
          onSubmit={(e) => { e.preventDefault(); send(draft) }}
        >
          {/* A textarea, not an input: questions composed from the report can
              run to several quoted bullets across multiple lines, and an
              `<input>` both strips the newlines and shows one line of 450
              characters. Grows with its content up to a cap, then scrolls. */}
          <textarea
            ref={inputRef}
            className={s.input}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention for
              // a chat box, and the reason this is not a plain form submit.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder="Ask a follow-up about this case…"
            disabled={streaming}
          />
          {streaming ? (
            <button type="button" className={s.stop} onClick={handleStop}>Stop</button>
          ) : (
            <button type="submit" className={s.send} disabled={!draft.trim()}>Send</button>
          )}
        </form>
      </div>
    </section>
  )
}
