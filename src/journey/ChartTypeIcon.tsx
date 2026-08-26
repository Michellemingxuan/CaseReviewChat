import s from './ChartTypeIcon.module.css'

/**
 * A glyph for a figure's chart TYPE.
 *
 * Replaces the thumbnail-sized rendering of the real chart. At ~90px a full
 * plot draws its labels on top of each other and every figure looks like the
 * same grey smear — the picture carries no information at that size, so the
 * card was spending its most prominent space on noise. A type glyph plus the
 * topic and provenance tells you what the card IS; the enlarged panel beside
 * it is where the figure gets read.
 *
 * `kind` values come from the server's ChartInfo: trend | bar | share |
 * trend_dual | trend_grid | table.
 */
export function ChartTypeIcon({ kind, className }: { kind?: string | null; className?: string }) {
  const k = (kind || '').toLowerCase()
  const { icon, label } = describe(k)
  return (
    <div className={`${s.wrap} ${className ?? ''}`} title={label}>
      <span className={s.glyph} aria-hidden="true">{icon}</span>
      <span className={s.label}>{label}</span>
    </div>
  )
}

function describe(kind: string): { icon: React.ReactNode; label: string } {
  switch (kind) {
    case 'bar':
      return { icon: <BarGlyph />, label: 'Bar' }
    case 'share':
      return { icon: <ShareGlyph />, label: 'Share' }
    case 'table':
      return { icon: <TableGlyph />, label: 'Table' }
    case 'trend_dual':
      return { icon: <TrendGlyph dual />, label: 'Dual trend' }
    case 'trend_grid':
      return { icon: <GridGlyph />, label: 'Trend grid' }
    case 'trend':
      return { icon: <TrendGlyph />, label: 'Trend' }
    default:
      // An unknown kind is still a figure; say so rather than showing nothing.
      return { icon: <TrendGlyph />, label: kind ? kind.replace(/_/g, ' ') : 'Figure' }
  }
}

const SVG = (props: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round">
    {props.children}
  </svg>
)

const TrendGlyph = ({ dual }: { dual?: boolean }) => (
  <SVG>
    <polyline points="3,16 8,10 13,13 21,5" />
    {dual && <polyline points="3,20 8,18 13,19 21,15" opacity="0.45" />}
  </SVG>
)
const BarGlyph = () => (
  <SVG>
    <line x1="5" y1="20" x2="5" y2="11" />
    <line x1="12" y1="20" x2="12" y2="5" />
    <line x1="19" y1="20" x2="19" y2="14" />
  </SVG>
)
const ShareGlyph = () => (
  <SVG>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="15" y2="12" />
    <line x1="4" y1="17" x2="9" y2="17" />
  </SVG>
)
const TableGlyph = () => (
  <SVG>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="10" y1="10" x2="10" y2="19" />
  </SVG>
)
const GridGlyph = () => (
  <SVG>
    <polyline points="3,10 6,7 9,9" />
    <polyline points="14,10 17,6 21,9" />
    <polyline points="3,19 6,16 9,18" />
    <polyline points="14,19 17,15 21,18" />
  </SVG>
)
