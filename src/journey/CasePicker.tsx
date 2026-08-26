import { useEffect, useRef, useState } from 'react'
import s from './CasePicker.module.css'

type Props = {
  cases: string[]
  activeCase: string | null
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * Case switcher, opened from "Back to Cases".
 *
 * The design replaces the classic sidebar's case list with a rail that is
 * scoped to ONE case, and shows a "← Back to Cases" link without drawing
 * what it goes back to. Until that screen is designed, this dialog covers
 * the capability the old sidebar provided — switching cases — without
 * inventing a full cases index that would then have to be thrown away.
 */
export function CasePicker({ cases, activeCase, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const needle = q.trim().toLowerCase()
  const shown = needle ? cases.filter((c) => c.toLowerCase().includes(needle)) : cases

  return (
    <div className={s.backdrop} onClick={onClose} role="presentation">
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Select a case"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.head}>
          <span className={`jEyebrow ${s.title}`}>Cases</span>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          ref={inputRef}
          className={s.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by case id…"
        />
        <ul className={s.list}>
          {shown.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={`${s.item} ${id === activeCase ? s.itemActive : ''}`}
                onClick={() => onPick(id)}
              >
                <span className={s.mono}>{id}</span>
                {id === activeCase && <span className={s.current}>current</span>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className={s.empty}>No case matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  )
}
