/**
 * Where the workspace is.
 *
 * Replaces an earlier pane-toggle model where `Report` and `Case Review
 * Assistant` were separately switchable rail items. That mirrored the design
 * (which lights both at once) but read as confusing: a rail entry that
 * sometimes hid a panel is not obviously navigation. Now the rail selects a
 * CASE, and a tab strip inside the case selects the page — the report and the
 * assistant are simply the two halves of Review, always both present, sized
 * by the draggable divider between them.
 */
export type JourneyPage = 'overview' | 'review' | 'opportunities'

/** The in-case tabs, in display order. */
export const CASE_TABS: readonly { page: JourneyPage; label: string }[] = [
  { page: 'review', label: 'Review' },
  { page: 'opportunities', label: 'Opportunities' },
] as const

export type Pillar = {
  id: string
  display_name: string
  focus: string
}

/** Case metadata shown in the rail and header.
 *
 *  `account` / `reviewType` / `pillar` are placeholders today — the backend
 *  exposes none of them (`GET /api/cases` returns bare id strings), so they
 *  are hard-coded to the design's values and must be replaced once a case
 *  metadata endpoint exists. `caseId` and `snapshotDate` are real.
 */
export type CaseFacts = {
  caseId: string | null
  /** Display name of the pillar this server is running. Real, unlike the
   *  design's other sample fields (Account / Review Type / Snapshot Date),
   *  which were removed rather than shown as if they were data. */
  pillar: string
}
