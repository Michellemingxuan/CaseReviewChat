import { useCallback, useEffect, useState } from 'react'
import { fetchCasesOverview } from '../../api'
import type { CaseOverviewRow } from '../../types'
import s from './OverviewView.module.css'

type Props = {
  activeCase: string | null
  onOpen: (caseId: string) => void
}

const day = (iso: string | null) => {
  if (!iso) return null
  // The API sends `YYYY-MM-DD` for report mtimes and a full ISO timestamp for
  // the last question; both reduce to a date, which is the granularity a
  // reviewer scans by.
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * The case list: what has been reviewed, how fresh its report is, and when it
 * was last asked about.
 *
 * Cases that have never been opened are listed too, at the bottom. They are
 * the ones actually needing attention, and a page that only showed finished
 * work would hide exactly the queue it exists to surface.
 */
export function OverviewView({ activeCase, onOpen }: Props) {
  const [rows, setRows] = useState<CaseOverviewRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchCasesOverview()
      .then((r) => { setRows(r); setError(null) })
      .catch((e) => setError(String((e as Error)?.message ?? e)))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className={s.wrap}>
      <section className={s.panel} aria-label="Cases">
        <div className={s.head}>
          <span className={`jEyebrow ${s.headTitle}`}>Cases</span>
          <span className={s.count}>{rows?.length ?? 0}</span>
          <button type="button" className={s.refresh} onClick={load}>Refresh</button>
        </div>

        {error && <p className={s.error}>Could not load cases. {error}</p>}
        {!rows && !error && <p className={s.note}>Loading…</p>}

        {rows && (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Case</th>
                <th>Report updated</th>
                <th>Sections</th>
                <th>Last Q&amp;A</th>
                <th>Turns</th>
                <th>Pins</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const reviewed = r.turns > 0
                return (
                  <tr
                    key={r.case_id}
                    className={r.case_id === activeCase ? s.rowActive : ''}
                    onDoubleClick={() => onOpen(r.case_id)}
                  >
                    <td className={s.mono}>
                      {r.case_id}
                      {!reviewed && <span className={s.newTag}>not started</span>}
                    </td>
                    <td>{day(r.report_updated_at) ?? <span className={s.dim}>no report</span>}</td>
                    <td>{r.report_sections || <span className={s.dim}>—</span>}</td>
                    <td>{day(r.last_qa_at) ?? <span className={s.dim}>never</span>}</td>
                    <td>{r.turns || <span className={s.dim}>—</span>}</td>
                    <td>{r.pins || <span className={s.dim}>—</span>}</td>
                    <td>
                      <button type="button" className={s.open} onClick={() => onOpen(r.case_id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Adding a case is a filesystem operation, not a UI one. Saying so
            is more useful than an upload control that cannot work: the server
            discovers cases from its data tables at boot, so a file dropped in
            the browser would have nowhere to go. */}
        <p className={s.footNote}>
          Cases are discovered from the server's data tables at startup, and their
          reports from <code>reports/&lt;case-id&gt;/</code>. To add one, put its
          data and report files there and restart the backend — it will appear here.
        </p>
      </section>
    </div>
  )
}
