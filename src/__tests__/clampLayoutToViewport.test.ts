import { describe, it, expect } from 'vitest'
import { clampLayoutToViewport } from '../components/Workspace/Workspace'
import { clampLayoutTogether } from '../lib/resizer'

describe('clampLayoutToViewport', () => {
  it('keeps values that fall inside the safe range', () => {
    const out = clampLayoutToViewport(
      { '--col-sidebar': '240px', '--col-chat': '720px', '--row-upper': '400px' },
      { vw: 1920, vh: 1080 },
    )
    expect(out['--col-sidebar']).toBe('240px')
    expect(out['--col-chat']).toBe('720px')
    expect(out['--row-upper']).toBe('400px')
  })

  it('drops a sidebar that is too wide for the new viewport', () => {
    // 400px sidebar on a narrow 1280-wide screen = 31% of viewport,
    // exceeds the 25% cap → drop so CSS default takes over.
    const out = clampLayoutToViewport(
      { '--col-sidebar': '400px' },
      { vw: 1280, vh: 720 },
    )
    expect(out['--col-sidebar']).toBeUndefined()
  })

  it('drops a sidebar that is too narrow', () => {
    const out = clampLayoutToViewport(
      { '--col-sidebar': '100px' },
      { vw: 1920, vh: 1080 },
    )
    expect(out['--col-sidebar']).toBeUndefined()
  })

  it('drops a chat column that exceeds 70% of viewport width', () => {
    // 1100px chat on a 1280-wide screen = 86% → drop.
    const out = clampLayoutToViewport(
      { '--col-chat': '1100px' },
      { vw: 1280, vh: 720 },
    )
    expect(out['--col-chat']).toBeUndefined()
  })

  it('drops a row-upper that exceeds 75% of viewport height', () => {
    const out = clampLayoutToViewport(
      { '--row-upper': '900px' },
      { vw: 1920, vh: 1080 },
    )
    expect(out['--row-upper']).toBeUndefined()
  })

  it('passes through non-px values (e.g. fr) without clamping', () => {
    // CSS grid-track values like "1.4fr" aren't pixel-bound — they
    // auto-adapt to any viewport, so the clamp shouldn't touch them.
    const out = clampLayoutToViewport(
      { '--col-chat': '1.4fr' },
      { vw: 1280, vh: 720 },
    )
    expect(out['--col-chat']).toBe('1.4fr')
  })

  it('clamps only the offending key, leaves the others intact', () => {
    const out = clampLayoutToViewport(
      {
        '--col-sidebar': '400px',  // too wide on 1280 viewport
        '--col-chat': '600px',     // fine
        '--row-upper': '400px',    // fine
      },
      { vw: 1280, vh: 720 },
    )
    expect(out['--col-sidebar']).toBeUndefined()
    expect(out['--col-chat']).toBe('600px')
    expect(out['--row-upper']).toBe('400px')
  })

  it('returns a new object — does not mutate the input', () => {
    const input = { '--col-sidebar': '400px' as string | undefined }
    clampLayoutToViewport(input, { vw: 1280, vh: 720 })
    expect(input['--col-sidebar']).toBe('400px')
  })

  it('handles an empty layout gracefully', () => {
    const out = clampLayoutToViewport({}, { vw: 1920, vh: 1080 })
    expect(out).toEqual({})
  })
})

describe('clampLayoutTogether', () => {
  it('keeps columns that fit side by side', () => {
    const out = clampLayoutTogether(
      { '--a': '400px', '--b': '600px' }, ['--a', '--b'], 8 + 320, 1920)
    expect(out['--a']).toBe('400px')
    expect(out['--b']).toBe('600px')
  })

  it('drops a column when two individually-legal widths cannot coexist', () => {
    // The real regression: report 492 and chat 751 each pass their own
    // percentage ceiling at 1280 wide, but together with the gutters and the
    // trace column's 320px floor they come to 1571 — so the trace was pushed
    // off screen entirely.
    const out = clampLayoutTogether(
      { '--j-col-report': '492px', '--j-col-chat': '751px' },
      ['--j-col-report', '--j-col-chat'], 8 + 320, 1280)

    expect(out['--j-col-chat']).toBeUndefined()   // the larger one goes first
    expect(out['--j-col-report']).toBe('492px')   // the smaller one still fits
  })

  it('drops repeatedly until what remains fits', () => {
    const out = clampLayoutTogether(
      { '--a': '900px', '--b': '800px' }, ['--a', '--b'], 8 + 320, 1000)
    expect(out['--a']).toBeUndefined()
    expect(out['--b']).toBeUndefined()
  })

  it('ignores non-pixel values rather than guessing their width', () => {
    const out = clampLayoutTogether(
      { '--a': '1.35fr' }, ['--a'], 8 + 320, 400)
    expect(out['--a']).toBe('1.35fr')
  })

  it('is a no-op when nothing is stored', () => {
    expect(clampLayoutTogether({}, ['--a'], 328, 1280)).toEqual({})
  })
})
