import type { Pin } from '../types'
import s from './PinProvenance.module.css'

/**
 * Where a pin came from, and whether it still stands.
 *
 * Deliberately does NOT lead with "Turn N". Turn numbers are positional — the
 * thread numbers turns by their place in it — so rewinding an earlier turn
 * renumbers everything after, and a pin captured as "Turn 3" silently starts
 * pointing at a different turn. Wrong provenance stated as fact is worse than
 * none, which is why the question is the primary label: it is what a reviewer
 * recognises and it never renumbers.
 */
export function PinProvenance({ pin }: { pin: Pin }) {
  // Report pins carry a section, not a question; turn pins carry a question.
  // Trim ONCE and decide everything from that: deriving the label from the
  // trimmed value while quoting on the raw one rendered a blank question as
  // a quoted fallback.
  const question = pin.question?.trim() || ''
  const label = question || pin.source || 'unknown source'
  const asked = pin.created_at
    ? new Date(pin.created_at * 1000).toLocaleTimeString(
        [], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <span className={s.wrap}>
      {pin.retracted && (
        <span className={s.retracted} title="This pin's turn was rewound. It is kept, but no longer part of the current thread.">
          retracted
        </span>
      )}
      <span className={s.label} title={label}>
        {question ? `“${label}”` : label}
      </span>
      {asked && <span className={s.time}>{asked}</span>}
    </span>
  )
}
