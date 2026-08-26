import { describe, it, expect } from 'vitest'
import { CASE_TABS } from '../journey/types'

/**
 * The pane-toggle model this file used to cover is gone. `Report` and
 * `Case Review Assistant` were separately switchable rail entries, which put
 * panel visibility where users expected navigation. The rail now selects a
 * CASE and a tab strip selects the page within it; Review always shows the
 * report, the assistant and the trace together, sized by their dividers.
 */
describe('case tabs', () => {
  it('offers exactly the two pages of a case, Review first', () => {
    expect(CASE_TABS.map((t) => t.page)).toEqual(['review', 'opportunities'])
  })

  it('labels them for the reviewer, not for the code', () => {
    expect(CASE_TABS.map((t) => t.label)).toEqual(['Review', 'Opportunities'])
  })
})
