import { useState } from 'react'
import { VegaChart } from '../components/PlotPanel/VegaChart'
import type { Pin } from '../types'
import s from './PinFigure.module.css'

/**
 * A pinned figure's image, with a real fallback when the file is gone.
 *
 * `<img>` paints the browser's broken-image glyph on a 404, which in a report
 * reads as a corrupted document rather than as a missing artifact — the same
 * failure the classic PlotPanel already guards against for empty urls
 * (commit 7ed8beb). That guard only covered `url === ''`; this one covers a
 * url that resolves to nothing, which is what happens when a pin outlives
 * the turn whose chart it points at.
 *
 * Newly-created pins are snapshotted server-side and should never hit this,
 * but pins made before snapshotting existed still can, and so can a case
 * folder pruned by hand. Saying what happened beats a broken glyph.
 */
/**
 * Strip a spec down to a glyph for thumbnail use.
 *
 * A thumbnail's job is to let you FIND a figure, not read it. Rendered at
 * ~90px the full chart draws its axis labels and title on top of each other
 * and the grid becomes noise — so titles, axes and legends come off, leaving
 * the shape, which is the part that is actually recognisable at that size.
 */
function toThumbSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const strip = (enc: unknown): unknown => {
    if (!enc || typeof enc !== 'object') return enc
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(enc as Record<string, unknown>)) {
      out[k] = (v && typeof v === 'object')
        ? { ...(v as object), axis: null, legend: null, title: null }
        : v
    }
    return out
  }
  const s2: Record<string, unknown> = { ...spec, title: null }
  if (s2.encoding) s2.encoding = strip(s2.encoding)
  // Layered / concatenated specs keep their children's chrome otherwise.
  for (const key of ['layer', 'vconcat', 'hconcat', 'concat']) {
    const arr = s2[key]
    if (Array.isArray(arr)) {
      s2[key] = arr.map((child) =>
        child && typeof child === 'object'
          ? { ...child, title: null, encoding: strip((child as { encoding?: unknown }).encoding) }
          : child)
    }
  }
  return s2
}

export function PinFigure({ pin, className, thumb }: {
  pin: Pin
  className?: string
  /** Render as a recognisable glyph rather than a readable chart. */
  thumb?: boolean
}) {
  const [failed, setFailed] = useState(false)

  // Prefer the spec: it is self-contained, so it renders even after the PNG
  // has been deleted, and it re-fits to whatever box it is given instead of
  // upscaling a raster.
  if (pin.vega_spec) {
    return (
      <div className={className}>
        <VegaChart
          spec={thumb ? toThumbSpec(pin.vega_spec) : pin.vega_spec}
          alt={pin.text || pin.topic || 'pinned figure'}
        />
      </div>
    )
  }

  if (!pin.chart_url || failed) {
    return (
      <div className={s.missing}>
        <span className={s.missingIcon} aria-hidden="true">⊘</span>
        <span>
          Figure file is no longer available
          {pin.turn_index != null && <> — turn {pin.turn_index} may have been rewound</>}.
        </span>
      </div>
    )
  }

  return (
    <img
      className={className}
      src={pin.chart_url}
      alt={pin.text || pin.topic || 'pinned figure'}
      onError={() => setFailed(true)}
    />
  )
}
