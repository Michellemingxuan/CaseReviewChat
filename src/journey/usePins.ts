import { useCallback, useEffect, useState } from 'react'
import { deletePin, fetchPins, postPin, postPinSection } from '../api'
import type { Pin } from '../types'
import type { TurnView } from './chat/turns'

/**
 * Pins for one case, plus the actions that create them.
 *
 * Server-backed rather than kept in the zustand store: pins are a review
 * deliverable that has to outlive the browser tab, and the store's persisted
 * slice is per-browser localStorage. The trade-off is that every mutation
 * re-reads the list — cheap at this size, and it keeps one source of truth.
 */
export function usePins(caseId: string | null) {
  const [pins, setPins] = useState<Pin[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!caseId) { setPins([]); return }
    try {
      setPins(await fetchPins(caseId))
      setError(null)
    } catch (e) {
      // A failed pin list must not blank the panel it lives in.
      console.error('Failed to load pins', e)
      setError(String((e as Error)?.message ?? e))
    }
  }, [caseId])

  useEffect(() => { void reload() }, [reload])

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e) {
      console.error('Pin action failed', e)
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }, [reload])

  /** Pin a claim from a turn. `text` is the reviewer's highlighted sentence
   *  when they made one; falling back to the whole answer keeps the button
   *  useful without a selection, but the sentence is the intended unit. */
  const pinInsight = useCallback((view: TurnView, text?: string) => {
    if (!caseId) return
    const claim = (text ?? view.answer ?? '').trim()
    if (!claim) return
    void run(() => postPin(caseId, {
      kind: 'insight',
      text: claim,
      turn_id: view.turnId,
      turn_index: view.index,
      source: `Turn ${view.index}`,
    }))
  }, [caseId, run])

  /** Pin one figure by topic, or every figure on the turn when `topic` is
   *  omitted. Idempotent server-side on (turn, specialist, topic), so a
   *  repeat click is a no-op. */
  const pinFigures = useCallback((view: TurnView, topic?: string) => {
    if (!caseId) return
    const wanted = topic ? view.charts.filter((c) => c.topic === topic) : view.charts
    if (wanted.length === 0) return
    void run(async () => {
      for (const c of wanted) {
        await postPin(caseId, {
          kind: 'figure',
          text: c.claim,
          turn_id: view.turnId,
          turn_index: view.index,
          source: `Turn ${view.index} · ${c.specialist}`,
          specialist: c.specialist,
          topic: c.topic,
          chart_url: c.url,
          vega_spec: c.vega_spec,
          chart_kind: c.kind,
        })
      }
    })
  }, [caseId, run])

  /** Pin text lifted from a curated report section, sourced to that section
   *  rather than to a turn — the provenance a reviewer needs is "Report ·
   *  Bureau", not a turn number it never came from. */
  const pinReportText = useCallback((text: string, sectionLabel: string) => {
    if (!caseId || !text.trim()) return
    void run(() => postPin(caseId, {
      kind: 'insight',
      text: text.trim(),
      source: `Report · ${sectionLabel}`,
    }))
  }, [caseId, run])

  const unpin = useCallback((pinId: string) => {
    if (!caseId) return
    void run(() => deletePin(caseId, pinId))
  }, [caseId, run])

  /** Insert a pin into a report section, or lift it out with null. */
  const setSection = useCallback((pinId: string, sectionKey: string | null) => {
    if (!caseId) return
    void run(() => postPinSection(caseId, pinId, sectionKey))
  }, [caseId, run])

  return { pins, busy, error, reload, pinInsight, pinFigures, pinReportText, unpin, setSection }
}
