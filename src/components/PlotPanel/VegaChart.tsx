import { useEffect, useRef } from 'react'
import embed, { type VisualizationSpec } from 'vega-embed'

/**
 * Renders a Vega-Lite v5 spec interactively, refitting whenever its
 * container resizes. Unlike a raster PNG, the chart re-paints at the
 * panel's current pixel size — drags on the workspace resizers feel
 * native because the SVG always matches the wrapper.
 *
 * Why this lives next to the PNG path: the server emits BOTH a static
 * PNG (`url`) and the Vega-Lite spec (`vega_spec`). When the spec is
 * present we use it (responsive, sharp at any zoom). When it's
 * missing (legacy KPs, distiller fallback) callers fall back to the
 * <img> tag in PlotPanel.tsx.
 *
 * Sizing strategy:
 *   - Override the spec's `width` and `height` with `"container"` so
 *     vega-lite consults the parent <div> on every redraw.
 *   - Watch the wrapper with ResizeObserver and call `view.resize()`
 *     on each fire — vega-embed does NOT automatically refit on
 *     parent size changes, only on the first render. Without this
 *     the SVG stays at the panel's INITIAL dimensions while the
 *     user drags the workspace resizer.
 *   - On spec change, dispose the prior view before re-embedding so
 *     we don't leak SVG nodes when the reviewer clicks between tabs.
 */
export function VegaChart({ spec, alt }: {
  spec: Record<string, unknown>
  alt?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<{ finalize?: () => void; resize?: () => void; view?: { resize: () => void; runAsync: () => Promise<unknown> } } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let cancelled = false

    // Inject container-relative sizing so the chart fills the parent
    // <div> rather than the spec's intrinsic numeric dimensions.
    const responsiveSpec: VisualizationSpec = {
      ...(spec as VisualizationSpec),
      width: 'container',
      height: 'container',
      // The chart provided by the server already styles its axes/legends
      // adequately; the `autosize` instruction below makes vega-lite
      // respect both `width: container` AND `height: container` rather
      // than only one. `fit-x` would keep height fixed → not what we
      // want when the user drags the panel vertically.
      autosize: { type: 'fit', contains: 'padding', resize: true },
    }

    embed(el, responsiveSpec, {
      actions: false,            // hide the vega menu — review-mode UI
      renderer: 'svg',
      tooltip: { theme: 'light' },
    })
      .then((result) => {
        if (cancelled) {
          result.finalize?.()
          return
        }
        viewRef.current = result
      })
      .catch((err) => {
        // Don't crash the panel — log + leave the wrapper empty. The
        // PlotPanel caller can decide whether to surface a fallback.
        // eslint-disable-next-line no-console
        console.warn('[VegaChart] embed failed:', err)
      })

    // Re-resize the chart on every container resize so it tracks the
    // workspace resizers (upper/lower split, tab column width, etc.).
    const ro = new ResizeObserver(() => {
      const view = viewRef.current?.view
      if (!view) return
      // `view.resize()` recomputes the layout from the container box;
      // `runAsync()` is the v5 way to commit a pending state change.
      view.resize()
      view.runAsync().catch(() => {/* swallow stale-resize errors */})
    })
    ro.observe(el)

    return () => {
      cancelled = true
      ro.disconnect()
      viewRef.current?.finalize?.()
      viewRef.current = null
    }
  }, [spec])

  return (
    <div
      ref={wrapRef}
      className="vegaChartWrap"
      role="img"
      aria-label={alt || 'chart'}
      style={{ width: '100%', height: '100%' }}
    />
  )
}
