import { useEffect, useState } from 'react'
import { fetchPillars } from '../api'
import type { JourneyPage, Pillar } from './types'
import s from './WorkspaceRail.module.css'

type Props = {
  page: JourneyPage
  cases: string[]
  activeCase: string | null
  unread: Set<string>
  onOpenCase: (caseId: string) => void
  onGoOverview: () => void
}

/**
 * The rail: pick a pillar, then pick a case.
 *
 * Navigation is by CASE, as in the classic sidebar — the thing a reviewer
 * actually moves between is cases, and an earlier version that listed panels
 * here ("Report", "Case Review Assistant") put panel visibility in the place
 * users expected navigation. Which PAGE you are on within a case is a tab
 * inside the case, not a rail entry.
 */
export function WorkspaceRail({
  page, cases, activeCase, unread, onOpenCase, onGoOverview,
}: Props) {
  const [pillars, setPillars] = useState<Pillar[]>([])
  const [activePillar, setActivePillar] = useState<string>('')

  const active = pillars.find((p) => p.id === activePillar) ?? null
  const others = pillars.filter((p) => p.id !== activePillar)

  useEffect(() => {
    fetchPillars()
      .then(({ active, pillars: list }) => { setActivePillar(active); setPillars(list) })
      .catch((e) => console.error('Failed to load pillars', e))
  }, [])

  return (
    <nav className={s.rail} aria-label="Cases">
      <div className={s.brand}>
        <span className={s.mark} aria-hidden="true">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none">
            <path d="M10 1.5 3 4.2v5.1c0 4 2.9 7.6 7 9.2 4.1-1.6 7-5.2 7-9.2V4.2L10 1.5Z"
                  fill="#fff" opacity=".95" />
          </svg>
        </span>
        <span className={s.brandText}>
          <b>SBS Risk Desk</b>
          <small>US SMALL BUSINESS</small>
        </span>
      </div>

      {/* The pillar is fixed at server start (`PILLAR` env), so this is a
          READOUT, not a control. A `<select>` was the wrong element even with
          its options disabled: it still opens, still takes focus, and still
          promises a choice that cannot be made. This states the active pillar
          and lists the others as unavailable. */}
      <div className={s.pillarBlock}>
        <div className={s.sectionLabel}>Pillar</div>
        <div
          className={s.pillarValue}
          title="Fixed when the server starts (PILLAR env). Switching requires a restart."
        >
          {active?.display_name ?? (pillars.length ? activePillar : 'Loading…')}
        </div>
        {others.length > 0 && (
          <div className={s.pillarOthers}>
            {others.map((p) => p.display_name).join(' · ')}
            <span className={s.pillarOthersNote}>not available</span>
          </div>
        )}
      </div>

      <button
        type="button"
        className={`${s.overviewBtn} ${page === 'overview' ? s.overviewActive : ''}`}
        aria-current={page === 'overview' ? 'true' : undefined}
        onClick={onGoOverview}
      >
        All cases
      </button>

      <div className={s.sectionLabel}>Cases</div>
      <ul className={s.list}>
        {cases.map((id) => {
          const active = id === activeCase && page !== 'overview'
          return (
            <li key={id}>
              <button
                type="button"
                className={`${s.caseItem} ${active ? s.caseActive : ''}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => onOpenCase(id)}
              >
                <span className={s.caseId}>{id}</span>
                {unread.has(id) && <span className={s.dot} aria-label="new activity" />}
              </button>
            </li>
          )
        })}
        {cases.length === 0 && <li className={s.empty}>No cases available.</li>}
      </ul>
    </nav>
  )
}
