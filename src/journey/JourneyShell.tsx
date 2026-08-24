import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { fetchCaseList, fetchPillars } from '../api'
import { WorkspaceRail } from './WorkspaceRail'
import { CaseHeader } from './CaseHeader'
import { CaseWorkspace } from './CaseWorkspace'
import { OpportunitiesView } from './views/OpportunitiesView'
import { OverviewView } from './views/OverviewView'
import { CASE_TABS } from './types'
import type { CaseFacts, JourneyPage } from './types'
import './tokens.css'
import s from './JourneyShell.module.css'

/**
 * Top-level shell: rail on the left, case header and page beneath.
 *
 * Two levels of navigation, kept distinct on purpose. The RAIL moves between
 * cases — that is what a reviewer actually navigates. The TAB STRIP moves
 * between the two pages of one case, Review and Opportunities. An earlier
 * version put panel toggles in the rail, which read as navigation and was
 * not.
 */
export function JourneyShell() {
  const caseList = useStore((st) => st.caseList)
  const activeCase = useStore((st) => st.activeCase)
  const unread = useStore((st) => st.unread)
  const setCaseList = useStore((st) => st.setCaseList)
  const setActiveCase = useStore((st) => st.setActiveCase)

  const [page, setPage] = useState<JourneyPage>('review')
  const [pillar, setPillar] = useState('')
  // A question composed in the report and handed to the assistant. Keyed so
  // asking the same thing twice still re-fires.
  const [ask, setAsk] = useState<{ text: string; key: number } | null>(null)

  useEffect(() => {
    fetchCaseList().then(setCaseList).catch(console.error)
    fetchPillars()
      .then(({ active, pillars }) => {
        setPillar(pillars.find((p) => p.id === active)?.display_name ?? active)
      })
      .catch(console.error)
  }, [setCaseList])

  const cases = useMemo(
    () => [...(caseList?.consumer ?? []), ...(caseList?.commercial ?? [])],
    [caseList],
  )

  // Open the first case automatically — the header and tabs are built around
  // one being in view, and an empty frame reads as a failed load.
  useEffect(() => {
    if (!activeCase && cases.length > 0) setActiveCase(cases[0])
  }, [activeCase, cases, setActiveCase])

  const facts: CaseFacts = { caseId: activeCase, pillar }
  const inCase = page !== 'overview'

  return (
    <div className={`journeyScope ${s.shell}`}>
      <WorkspaceRail
        page={page}
        cases={cases}
        activeCase={activeCase}
        unread={unread}
        onOpenCase={(id) => {
          setActiveCase(id)
          // Opening a case from the rail lands on Review; jumping straight to
          // another case's Opportunities is not what the click means.
          setPage('review')
        }}
        onGoOverview={() => setPage('overview')}
      />

      <div className={s.main}>
        <CaseHeader
          facts={inCase ? facts : { caseId: null, pillar }}
          tabs={inCase ? (
            <div className={s.tabs} role="tablist" aria-label="Case pages">
              {CASE_TABS.map((t) => (
                <button
                  key={t.page}
                  type="button"
                  role="tab"
                  aria-selected={page === t.page}
                  className={`${s.tab} ${page === t.page ? s.tabActive : ''}`}
                  onClick={() => setPage(t.page)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
          onBack={inCase ? () => setPage('overview') : undefined}
        />

        {page === 'overview' && (
          <OverviewView
            activeCase={activeCase}
            onOpen={(id) => { setActiveCase(id); setPage('review') }}
          />
        )}
        {page === 'review' && (
          <CaseWorkspace
            caseId={activeCase}
            ask={ask}
            onAsk={(text) => setAsk({ text, key: Date.now() })}
          />
        )}
        {page === 'opportunities' && <OpportunitiesView caseId={activeCase} />}
      </div>
    </div>
  )
}
