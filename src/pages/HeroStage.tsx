import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/* Hero "expand" intro, modelled on ondo.finance (read from their page bundle):
 *  - starts as a full-bleed video on black with white text
 *  - the first wheel-down / swipe-up / scroll key (page at top) expands it over 1.15s:
 *      background black -> white; three nested video layers scale + clip-path into concentric
 *      rounded squares (sizes ed, 0.86ed, 0.61ed); the headline splits to the left and right of them
 *  - page scroll is locked while it animates; scrolling up at the very top collapses it again
 *  - prefers-reduced-motion: starts expanded, no gestures, no autoplay */

const DURATION_MS = 1150
const LOCK_MS = 1200
const RADII = [0, 36, 36]
const SCALES = [1, 0.86, 0.61]

const idx = (i: number) => ({ '--i': i }) as CSSProperties

interface Props {
  open: boolean
  reduced: boolean
  /** `instant` skips the transition (used when the page is scrolled before the user triggers the intro) */
  setOpen: (open: boolean, instant?: boolean) => void
  instant: boolean
}

/** Sizes lifted from ondo.finance's hero: the square grows with viewport width and height up to 569px. */
function layout(w: number, h: number) {
  const lg = w >= 1200
  const ea = Math.min(Math.min(1, Math.max(0, (w - 1300) / 400)), Math.min(1, Math.max(0, (h - 700) / 200)))
  const ed = lg ? Math.round(390 + 179 * ea) : Math.max(300, Math.round(Math.min(0.55 * h, 0.75 * w, 360)))
  const outerRadius = lg ? Math.round(27 + 25 * ea) : 32
  const gap = lg ? Math.round(32 + 48 * ea) : 60
  const min = Math.min(w, h)
  const landscape = w >= h
  const layers = SCALES.map((k, i) => {
    const size = Math.round(ed * k)
    const s = size / min
    const radius = i === 0 ? outerRadius : RADII[i]!
    return { s, cx: landscape ? (w - h) / 2 : 0, cy: landscape ? 0 : (h - w) / 2, r: radius / s }
  })
  return { ed, gap, layers }
}

export function HeroStage({ open, reduced, setOpen, instant }: Props) {
  const heroRef = useRef<HTMLElement>(null)
  const vids = useRef<(HTMLVideoElement | null)[]>([])
  const [dims, setDims] = useState({ w: 1280, h: 720 })
  const [warm, setWarm] = useState(false)
  const openRef = useRef(open)
  const lock = useRef(false)
  const lockTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    const el = heroRef.current
    if (!el) return
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The two outer layers only start loading a moment after first paint (Ondo does the same after 1s).
  useEffect(() => {
    if (reduced) return
    const t = window.setTimeout(() => setWarm(true), 1000)
    return () => window.clearTimeout(t)
  }, [reduced])

  // The outer layers mirror the main video; keep them in sync and only decode them while expanded.
  useEffect(() => {
    const main = vids.current[2]
    if (reduced) {
      main?.pause()
      return
    }
    for (const i of [0, 1]) {
      const v = vids.current[i]
      if (!v) continue
      if (open && warm) {
        if (main && v.readyState > 0) v.currentTime = main.currentTime
        void v.play().catch(() => {})
      } else v.pause()
    }
  }, [open, warm, reduced])

  const toggle = useCallback(
    (next: boolean) => {
      if (lock.current || openRef.current === next) return
      lock.current = true
      window.clearTimeout(lockTimer.current)
      lockTimer.current = window.setTimeout(() => {
        lock.current = false
      }, LOCK_MS)
      setOpen(next)
    },
    [setOpen],
  )

  useEffect(() => {
    if (reduced) return
    if (window.scrollY > 8 && !openRef.current) setOpen(true, true)

    let topSince = performance.now()
    let touchY = 0
    const atTop = () => window.scrollY <= 1
    const settledAtTop = () => atTop() && topSince >= 0 && performance.now() - topSince > 600

    const onScroll = () => {
      if (window.scrollY > 1) topSince = -1
      else if (topSince < 0) topSince = performance.now()
      // scrolled by something other than a gesture (scrollbar, anchor link): open without the animation
      if (!openRef.current && window.scrollY > 8 && !lock.current) setOpen(true, true)
    }
    const onWheel = (e: WheelEvent) => {
      if (lock.current) {
        e.preventDefault()
        return
      }
      if (!openRef.current && e.deltaY > 0) {
        e.preventDefault()
        toggle(true)
      } else if (openRef.current && e.deltaY < 0 && settledAtTop()) {
        e.preventDefault()
        toggle(false)
      }
    }
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? touchY
      if (lock.current) {
        if (e.cancelable) e.preventDefault()
        return
      }
      if (!openRef.current && touchY - y > 20) {
        if (e.cancelable) e.preventDefault()
        toggle(true)
      } else if (openRef.current && y - touchY > 30 && settledAtTop()) {
        toggle(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const down = e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === 'End'
      if (!down) return
      if (lock.current) {
        e.preventDefault()
        return
      }
      if (!openRef.current && e.key !== 'End') {
        e.preventDefault()
        toggle(true)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(lockTimer.current)
    }
  }, [reduced, setOpen, toggle])

  const { ed, gap, layers } = useMemo(() => layout(dims.w, dims.h), [dims])
  const cls = `lp-hero${open ? ' is-open' : ''}${instant ? ' is-instant' : ''}`
  const vars = { '--ed': `${ed}px`, '--gap': `${gap}px`, '--dur': `${DURATION_MS}ms` } as CSSProperties

  return (
    <section ref={heroRef} className={cls} style={vars} aria-label="Introduction">
      <div className="lp-layers" aria-hidden="true">
        {layers.map((l, i) => (
          <div
            key={i}
            className="lp-layer"
            style={{ '--s': l.s, '--cx': `${l.cx}px`, '--cy': `${l.cy}px`, '--r': `${l.r}px` } as CSSProperties}
          >
            <video
              ref={(el) => {
                vids.current[i] = el
              }}
              className="lp-layer-video"
              src={i === 2 || warm ? '/hero.mp4' : undefined}
              poster="/hero-poster.jpg"
              muted
              loop
              playsInline
              autoPlay={i === 2 && !reduced}
              preload={i === 2 ? 'auto' : 'metadata'}
              tabIndex={-1}
            />
          </div>
        ))}
      </div>

      <div className="lp-hero-grid">
        <h1 className="lp-h1">
          <span className="lp-h1-l" data-reveal="rise">Welcome to&nbsp;</span>
          <span className="lp-h1-r" data-reveal="rise" style={idx(1)}>Fair Markets</span>
        </h1>
        <div className="lp-hero-mid" aria-hidden="true" />
      </div>

      <p className="lp-hero-copy" data-reveal="rise" style={idx(3)}>
        A Uniswap v4 hook that charges more when a swap closes a gap with the real stock price, and the base fee for everyone else.
      </p>

      <button type="button" className="lp-cue" onClick={() => toggle(true)} tabIndex={open ? -1 : 0} aria-hidden={open}>
        <span className="lp-cue-fine">Scroll</span>
        <span className="lp-cue-coarse">Swipe to explore</span>
        <i />
      </button>
    </section>
  )
}
