import { useEffect, useMemo, useRef } from 'react'
import { GLOBE_ROWS } from './globeData.ts'

/* Rotating dot-matrix globe. Land comes from a Natural Earth mask (globeData.ts); each frame the dots are rotated about the
 * vertical axis, projected orthographically, and the far hemisphere is dropped. Dots near the limb shrink and fade. */

const KIND_COLORS = ['#E3EBDF', '#00c386', '#0b7a4b'] as const // ocean, coast, interior
const ALPHA = [0.42, 0.75, 1] as const
const SIZE = [0.58, 0.82, 1] as const
const SPIN_RAD_PER_S = (Math.PI * 2) / 46 // one turn every 46 seconds
const TILT = 0.38 // look slightly down on the northern hemisphere

interface Dot {
  x: number
  y: number
  z: number
  k: 0 | 1 | 2
}

function buildDots(): Dot[] {
  const out: Dot[] = []
  const rows = GLOBE_ROWS.length
  GLOBE_ROWS.forEach((row, i) => {
    const lat = ((-90 + (i + 0.5) * (180 / rows)) * Math.PI) / 180
    for (let j = 0; j < row.length; j++) {
      const lon = ((-180 + (j + 0.5) * (360 / row.length)) * Math.PI) / 180
      out.push({ x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon), k: Number(row[j]) as 0 | 1 | 2 })
    }
  })
  return out
}

interface Props {
  /** changes whenever the copy changes; the globe gives itself a 120 degree spin each time */
  spinKey: number
  /** only animate while visible */
  active: boolean
  reduced: boolean
}

export function Globe({ spinKey, active, reduced }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dots = useMemo(() => buildDots(), [])
  const state = useRef({ angle: 4.2, extra: 0, extraTarget: 0 })
  const draw = useRef<() => void>(() => {})
  const first = useRef(true)

  // each belief change adds a spin that eases out
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    state.current.extraTarget += (Math.PI * 2) / 3
  }, [spinKey])

  // draw one frame at the current angle
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let size = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      size = Math.round(cv.clientWidth * dpr)
      if (cv.width !== size) {
        cv.width = size
        cv.height = size
      }
      draw.current()
    }

    draw.current = () => {
      if (!size) return
      const R = size * 0.495
      const c = size / 2
      const a = state.current.angle + state.current.extra
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const ct = Math.cos(TILT)
      const st = Math.sin(TILT)
      ctx.clearRect(0, 0, size, size)
      const base = R * 0.019

      // bucket by colour and depth so each bucket is a single path
      const buckets: Path2D[] = Array.from({ length: 9 }, () => new Path2D())
      for (const d of dots) {
        const x1 = d.x * ca + d.z * sa
        const z1 = -d.x * sa + d.z * ca
        const y2 = d.y * ct - z1 * st
        const z2 = d.y * st + z1 * ct
        if (z2 < -0.02) continue
        const depth = z2 < 0.28 ? 0 : z2 < 0.62 ? 1 : 2
        const r = base * SIZE[depth]!
        const px = c + x1 * R
        const py = c - y2 * R
        const p = buckets[d.k * 3 + depth]!
        p.moveTo(px + r, py)
        p.arc(px, py, r, 0, Math.PI * 2)
      }
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = KIND_COLORS[k]!
        for (let depth = 0; depth < 3; depth++) {
          ctx.globalAlpha = ALPHA[depth]!
          ctx.fill(buckets[k * 3 + depth]!)
        }
      }
      ctx.globalAlpha = 1
    }

    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()
    return () => ro.disconnect()
  }, [dots])

  // animation loop (only while visible, never with reduced motion)
  useEffect(() => {
    if (!active || reduced) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = state.current
      s.angle += SPIN_RAD_PER_S * dt
      s.extra += (s.extraTarget - s.extra) * (1 - Math.exp(-dt * 2.4))
      draw.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, reduced])

  return <canvas ref={canvas} className="lp-disc" role="img" aria-label="A rotating globe made of dots" />
}
