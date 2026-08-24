import s from './PlaceholderView.module.css'

type Props = {
  title: string
  blurb: string
  /** What has to exist before this screen can be built for real. */
  blockedOn?: string[]
}

/**
 * Stand-in for a rail destination that is designed but not yet built.
 *
 * States what is missing rather than showing an empty frame — an unbuilt
 * screen and a broken one look identical otherwise, and this shell is meant
 * to be clicked through before the remaining screens exist.
 */
export function PlaceholderView({ title, blurb, blockedOn }: Props) {
  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <span className={s.tag}>Not built yet</span>
        <h2 className={s.title}>{title}</h2>
        <p className={s.blurb}>{blurb}</p>
        {blockedOn && blockedOn.length > 0 && (
          <>
            <div className={s.label}>Needs first</div>
            <ul className={s.list}>
              {blockedOn.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
