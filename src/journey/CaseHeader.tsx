import type { CaseFacts } from './types'
import s from './CaseHeader.module.css'

type Props = {
  facts: CaseFacts
  /** In-case page tabs (Review / Opportunities), or null on Overview. */
  tabs?: React.ReactNode
  onBack?: () => void
}

/**
 * Case header: identity on the left, review actions on the right.
 *
 * The three action buttons are presentational for now — Export / Share /
 * Complete Review have no backend (`server.py` exposes no review-lifecycle
 * route), so they are rendered disabled with a title rather than wired to a
 * no-op. A button that looks live and does nothing is worse than one that
 * says it is not ready yet.
 */
export function CaseHeader({ facts, tabs, onBack }: Props) {
  return (
    <header className={s.header}>
      <div className={s.identity}>
        <button type="button" className={s.back} onClick={onBack} disabled={!onBack}>
          ← All cases
        </button>
        <div className={s.titleRow}>
          <h1 className={s.caseId}>{facts.caseId ?? 'No case selected'}</h1>
          {/* `reviewType` and `status` were sample values with nothing behind
              them; only the pillar is real. See the note in WorkspaceRail. */}
          {facts.caseId && <span className={s.pillarPill}>{facts.pillar}</span>}
        </div>
      </div>

      {tabs}

      <div className={s.actions}>
        <button type="button" className={s.ghost} disabled title="Not implemented yet">
          Export review package
        </button>
        <button type="button" className={s.ghost} disabled title="Not implemented yet">
          Share
        </button>
        <button type="button" className={s.primary} disabled title="Not implemented yet">
          ✓&nbsp;&nbsp;Complete Review
        </button>
      </div>
    </header>
  )
}
