/**
 * Drag-to-resize plumbing shared by the classic Workspace and the journey
 * shell. Both lay panels out with CSS grid over custom properties, so a
 * resizer is just "write a px value into `--var` on the container, and
 * remember it".
 *
 * Extracted verbatim from `components/Workspace/Workspace.tsx` when the
 * journey shell needed the same behaviour for a different set of columns.
 * Kept generic over the var name for that reason — nothing here knows
 * which panels it is sizing.
 */

/** Persisted layout, keyed by CSS custom-property name. */
export type LayoutSizes = Record<string, string | undefined>

/** Bounds for one layout variable, in CSS pixels. `max` may be a
 *  fraction of the viewport rather than an absolute size. */
export type ClampRule = {
  min: number
  /** Absolute px ceiling. */
  max?: number
  /** Ceiling as a fraction of viewport width (0–1). Mutually exclusive with `maxVh`. */
  maxVw?: number
  /** Ceiling as a fraction of viewport height (0–1). */
  maxVh?: number
}

export function loadLayout(storageKey: string): LayoutSizes {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as LayoutSizes) : {}
  } catch {
    // Corrupt/absent JSON must not take the app down — an unreadable
    // layout is a cosmetic loss, and the CSS defaults are already correct.
    return {}
  }
}

export function saveLayout(storageKey: string, patch: LayoutSizes) {
  const next = { ...loadLayout(storageKey), ...patch }
  // Drop empty/undefined keys so a double-click reset truly resets rather
  // than persisting `undefined` and re-reading it as "no value" forever.
  Object.keys(next).forEach((k) => { if (!next[k]) delete next[k] })
  localStorage.setItem(storageKey, JSON.stringify(next))
}

function parsePx(v: string | undefined): number | null {
  if (!v) return null
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*px$/)
  return m ? parseFloat(m[1]) : null
}

/**
 * Clamp persisted layout values against the current viewport.
 *
 * Stored values are raw pixel strings captured on whichever screen the user
 * last sized things on. Moving the window between screens of different
 * dimensions (high-DPI external monitor -> laptop) can leave those values
 * far out of range: a 400px rail is sensible at 2560 wide and eats a third
 * of the width at 1280. A hard refresh would reapply them and the layout
 * would look plainly broken.
 *
 * Out-of-range keys are OMITTED from the result rather than corrected, so
 * the CSS default (an `fr` track) takes over and adapts to the new
 * viewport. Values stored in non-px units are left alone.
 */
export function clampLayout(
  saved: LayoutSizes,
  rules: Record<string, ClampRule>,
  viewport?: { vw: number; vh: number },
): LayoutSizes {
  const vw = viewport?.vw ?? (typeof window !== 'undefined' ? window.innerWidth : 1920)
  const vh = viewport?.vh ?? (typeof window !== 'undefined' ? window.innerHeight : 1080)
  const out: LayoutSizes = { ...saved }

  for (const [varName, rule] of Object.entries(rules)) {
    const px = parsePx(saved[varName])
    if (px == null) continue
    const ceiling = rule.max
      ?? (rule.maxVw != null ? vw * rule.maxVw : undefined)
      ?? (rule.maxVh != null ? vh * rule.maxVh : undefined)
      ?? Infinity
    if (px < rule.min || px > ceiling) delete out[varName]
  }
  return out
}

/**
 * Drop stored column widths that cannot COEXIST at this viewport width.
 *
 * `clampLayout` checks each variable on its own, which is not enough: two
 * columns can each be individually legal and still not fit together. A real
 * case — report 492px (under its 45%-of-viewport ceiling) and chat 751px
 * (under its 60%) — is fine at 1920 wide and impossible at 1280, where
 * 492 + 751 + gutters + the trace column's 360px floor comes to 1611. The
 * per-variable clamp kept both, the grid overflowed, and the third column
 * was pushed off screen entirely.
 *
 * When the total does not fit, the LARGEST stored column is dropped first
 * (it has the most to give) and the check repeats. Dropped variables fall
 * back to their `fr` default, which by construction always fits.
 *
 * `reserve` is the space the un-stored tracks need: gutters plus any
 * remaining column's minimum.
 */
export function clampLayoutTogether(
  saved: LayoutSizes,
  varNames: string[],
  reserve: number,
  viewportWidth?: number,
): LayoutSizes {
  const vw = viewportWidth
    ?? (typeof window !== 'undefined' ? window.innerWidth : 1920)
  const out: LayoutSizes = { ...saved }

  const widthOf = (v: string): number => {
    const m = out[v]?.trim().match(/^(\d+(?:\.\d+)?)\s*px$/)
    return m ? parseFloat(m[1]) : 0
  }

  for (;;) {
    const stored = varNames.filter((v) => widthOf(v) > 0)
    if (stored.length === 0) break
    const total = stored.reduce((sum, v) => sum + widthOf(v), 0)
    if (total + reserve <= vw) break
    // Drop the biggest offender and re-check; the rest may now fit.
    const biggest = stored.reduce((a, b) => (widthOf(a) >= widthOf(b) ? a : b))
    delete out[biggest]
  }
  return out
}

/**
 * Apply a clamped layout to a container: set the vars that survived
 * clamping, and REMOVE any inline value for those that did not, so the
 * stylesheet default applies. Removing matters — leaving a stale inline
 * value behind is exactly the broken-after-screen-change case.
 */
export function applyLayout(
  container: HTMLElement | null,
  saved: LayoutSizes,
  varNames: string[],
) {
  if (!container) return
  for (const v of varNames) {
    if (saved[v]) container.style.setProperty(v, saved[v] as string)
    else container.style.removeProperty(v)
  }
}

/**
 * Wire one drag handle. `minBefore` / `minAfter` are the pixel floors for
 * the tracks either side of it; the handle can never be dragged somewhere
 * that would starve its neighbour. Double-click clears the variable and
 * the persisted entry, resetting just this divider.
 *
 * Returns a teardown function that removes the listeners it added.
 */
export function setupResizer({
  handle, container, axis, varName, minBefore, minAfter, storageKey, gutter = 4,
}: {
  handle: HTMLElement | null
  container: HTMLElement | null
  axis: 'x' | 'y'
  varName: string
  minBefore: number
  minAfter: number
  storageKey: string
  gutter?: number
}): () => void {
  if (!handle || !container) return () => {}
  let startPos = 0, startSize = 0, containerSize = 0

  const onMove = (e: MouseEvent) => {
    const pos = axis === 'x' ? e.clientX : e.clientY
    const maxSize = containerSize - minAfter - gutter
    const next = Math.max(minBefore, Math.min(maxSize, startSize + (pos - startPos)))
    container.style.setProperty(varName, `${next}px`)
  }
  const onUp = () => {
    handle.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    const finalValue = container.style.getPropertyValue(varName)
    if (finalValue) saveLayout(storageKey, { [varName]: finalValue })
  }
  const onDown = (e: MouseEvent) => {
    e.preventDefault()
    handle.classList.add('dragging')
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    const cRect = container.getBoundingClientRect()
    containerSize = axis === 'x' ? cRect.width : cRect.height
    const before = handle.previousElementSibling as HTMLElement | null
    if (before) {
      const bRect = before.getBoundingClientRect()
      startSize = axis === 'x' ? bRect.width : bRect.height
    }
    startPos = axis === 'x' ? e.clientX : e.clientY
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const onDblClick = () => {
    container.style.removeProperty(varName)
    saveLayout(storageKey, { [varName]: undefined })
  }

  handle.addEventListener('mousedown', onDown)
  handle.addEventListener('dblclick', onDblClick)
  return () => {
    handle.removeEventListener('mousedown', onDown)
    handle.removeEventListener('dblclick', onDblClick)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
}
