import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * A modal sheet, rendered into `document.body` rather than where it is written.
 *
 * The portal is not a nicety. Written in place, the sheet lands inside `main.content`,
 * which carries `-webkit-overflow-scrolling: touch` — that puts it on its own compositing
 * layer on iOS. The tab bar has `backdrop-filter`, which does the same. WebKit then paints
 * the nav over the fixed scrim whatever the z-index says, so the Cancel and Save buttons
 * at the bottom of the sheet sat underneath the tab bar and could not be reached. Desktop
 * browsers honour the z-index and show nothing wrong, which is what made it hard to see.
 *
 * At the top level the sheet is a sibling of `.app`, later in the document and in the root
 * stacking context, so there is no scrolling layer for the nav to be promoted above.
 */
export function Sheet({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
