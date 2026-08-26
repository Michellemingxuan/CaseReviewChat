import { useEffect } from 'react'
import { VegaChart } from '../components/PlotPanel/VegaChart'
import s from './FigureLightbox.module.css'

export type LightboxFigure = {
  title: string
  caption?: string
  /** Vega-Lite spec, when the server sent one. Preferred: it re-fits to the
   *  overlay's size instead of upscaling a fixed raster. */
  spec?: Record<string, unknown> | null
  /** Static PNG fallback. */
  url?: string | null
}

/**
 * Full-size view of one figure.
 *
 * The turn card lives in the narrow middle column, so a chart there is
 * necessarily small — small enough that reading a value off an axis is
 * guesswork. Inserting the figure into the report was the only way to see it
 * bigger, which made a REVIEW decision (does this belong in the report?)
 * the price of a READING one (what does this chart say?). This separates
 * them: any figure can be opened large, from anywhere, without being filed.
 */
export function FigureLightbox({ figure, onClose }: {
  figure: LightboxFigure | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!figure) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // Stop the panel behind the overlay from scrolling under it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [figure, onClose])

  if (!figure) return null

  return (
    <div className={s.backdrop} onClick={onClose} role="presentation">
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={figure.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.head}>
          <span className={s.title}>{figure.title}</span>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={s.body}>
          {figure.spec
            ? <VegaChart spec={figure.spec} alt={figure.caption || figure.title} />
            : figure.url
              ? <img className={s.png} src={figure.url} alt={figure.caption || figure.title} />
              : <p className={s.missing}>No renderable figure.</p>}
        </div>
        {figure.caption && <p className={s.caption}>{figure.caption}</p>}
      </div>
    </div>
  )
}
