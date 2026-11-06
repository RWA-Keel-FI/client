import type { CSSProperties } from 'react'
import { idx } from './landingData.ts'

/* ---- motion helpers -------------------------------------------------------
 * Reproduces the reveal pattern read from ondo.finance's bundle (Motion lib):
 *   whileInView + once, easeOut; text = masked line sliding up 100%; cards = fade + 40px
 *   rise on a critically damped spring (stiffness 100, damping 20, mass 1), 0.1s stagger.
 * One IntersectionObserver adds `.in` to every [data-reveal] element; CSS does the rest. */
/** Lines of a heading, each in an overflow mask, rising one after another. */
export function Lines({ lines, start = 0 }: { lines: string[]; start?: number }) {
  return (
    <>
      {lines.map((l, k) => (
        <span className="lp-mask" key={l}>
          <span data-reveal="mask" style={idx(start + k)}>{l}</span>
        </span>
      ))}
    </>
  )
}

/** Rolling-digit counter: one 0-9 column per digit, rolled to its value when scrolled into view. */
export function Odometer({ value }: { value: string }) {
  return (
    <span className="lp-odo" data-reveal="odo" role="text" aria-label={value}>
      {value.split('').map((ch, k) =>
        /\d/.test(ch) ? (
          <span className="lp-odo-col" aria-hidden="true" key={k} style={{ ...idx(k), '--d': Number(ch) } as CSSProperties}>
            <span className="lp-odo-strip">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <i key={n}>{n}</i>
              ))}
            </span>
          </span>
        ) : (
          <span aria-hidden="true" key={k}>{ch}</span>
        ),
      )}
    </span>
  )
}

