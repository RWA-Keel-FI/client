import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Candle } from '../lib/market/history.ts'
import { usd } from '../lib/market/format.ts'

export type ChartStyle = 'candles' | 'line'

interface Props {
  candles: Candle[]
  style: ChartStyle
  showRef: boolean
  label: string
  /** height of the price panel in px */
  priceHeight?: number
  /** colour the line, area and last-price tag by this direction instead of the last candle's */
  trend?: 'up' | 'down'
}

const PAD_R = 64
const VOL_H = 44
const FEE_H = 76
const GAP = 10
const AXIS_H = 22

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(320, Math.floor(e.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function hhmm(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** SVG price chart: candles or line, the oracle reference as a dashed line, volume, and the fee actually charged under it. */
export function CandleChart({ candles, style, showRef, label, priceHeight = 300, trend }: Props) {
  const [wrap, W] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const n = candles.length

  if (n === 0) {
    return (
      <div ref={wrap} className="mk-chart-empty" role="status">
        Collecting price samples...
      </div>
    )
  }

  const plotW = W - PAD_R
  const H = priceHeight + GAP + VOL_H + GAP + FEE_H + AXIS_H
  const yVol0 = priceHeight + GAP
  const yFee0 = yVol0 + VOL_H + GAP
  const step = plotW / n
  const bw = Math.max(1.5, Math.min(14, step * 0.68))
  const cx = (i: number) => (i + 0.5) * step

  let lo = Infinity
  let hi = -Infinity
  let maxVol = 0
  let maxFee = 0
  for (const c of candles) {
    lo = Math.min(lo, c.l, showRef ? c.ref : Infinity)
    hi = Math.max(hi, c.h, showRef ? c.ref : -Infinity)
    maxVol = Math.max(maxVol, c.vol)
    maxFee = Math.max(maxFee, c.fee, c.baseFee)
  }
  const span = hi - lo || hi * 0.001 || 1
  lo -= span * 0.08
  hi += span * 0.08
  const yP = (v: number) => ((hi - v) / (hi - lo)) * priceHeight
  const yFee = (v: number) => yFee0 + FEE_H - (v / (maxFee * 1.15 || 1)) * FEE_H

  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / 5)
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))))

  const last = candles[n - 1]!
  const shownIdx = hover ?? n - 1
  const d = candles[shownIdx]!
  const up = d.c >= d.o

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    setHover(x > plotW ? null : Math.min(n - 1, Math.max(0, Math.floor(x / step))))
  }

  const linePts = candles.map((c, i) => `${cx(i).toFixed(1)},${yP(c.c).toFixed(1)}`).join(' ')
  const refPts = candles.map((c, i) => `${cx(i).toFixed(1)},${yP(c.ref).toFixed(1)}`).join(' ')
  const lastUp = trend ? trend === 'up' : last.c >= last.o

  return (
    <div ref={wrap} className="mk-chart">
      <dl className="mk-legend" aria-live="off">
        <div>
          <dt>{hhmm(d.t)}</dt>
        </div>
        <div className={up ? 'mk-up-t' : 'mk-down-t'}>
          <dt>O</dt>
          <dd>{usd(d.o, 2)}</dd>
          <dt>H</dt>
          <dd>{usd(d.h, 2)}</dd>
          <dt>L</dt>
          <dd>{usd(d.l, 2)}</dd>
          <dt>C</dt>
          <dd>{usd(d.c, 2)}</dd>
        </div>
        <div>
          <dt>Ref</dt>
          <dd>{usd(d.ref, 2)}</dd>
          <dt>Dev</dt>
          <dd>{d.dev.toFixed(1)} bps</dd>
          <dt>Fee</dt>
          <dd className={d.fee > d.baseFee + 0.01 ? 'surcharge' : undefined}>{d.fee.toFixed(0)} bps</dd>
          {maxVol > 0 && (
            <>
              <dt>Vol</dt>
              <dd>{usd(d.vol, 0)}</dd>
            </>
          )}
        </div>
      </dl>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`${label}: ${n} candles, last close ${usd(last.c, 2)}, reference ${usd(last.ref, 2)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* price grid + axis */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={plotW} y1={yP(v)} y2={yP(v)} className="mk-grid" />
            {Math.abs(yP(v) - yP(last.c)) > 12 && (
              <text x={W - 6} y={yP(v) + 4} textAnchor="end" className="mk-tick">
                {v.toFixed(2)}
              </text>
            )}
          </g>
        ))}

        {style === 'line' ? (
          <>
            <polygon points={`${cx(0)},${priceHeight} ${linePts} ${cx(n - 1)},${priceHeight}`} className={lastUp ? 'mk-area mk-area-up' : 'mk-area mk-area-down'} />
            <polyline points={linePts} className={lastUp ? 'mk-line mk-up-s' : 'mk-line mk-down-s'} fill="none" />
          </>
        ) : (
          candles.map((c, i) => {
            const isUp = c.c >= c.o
            const top = yP(Math.max(c.o, c.c))
            const h = Math.max(1, Math.abs(yP(c.o) - yP(c.c)))
            return (
              <g key={c.t} className={isUp ? 'mk-up' : 'mk-down'}>
                <line x1={cx(i)} x2={cx(i)} y1={yP(c.h)} y2={yP(c.l)} className="mk-wick" />
                <rect x={cx(i) - bw / 2} y={top} width={bw} height={h} className="mk-body" />
              </g>
            )
          })
        )}

        {showRef && <polyline points={refPts} className="mk-ref" fill="none" />}

        {/* last price tag */}
        <line x1={0} x2={plotW} y1={yP(last.c)} y2={yP(last.c)} className={lastUp ? 'mk-last mk-up-s' : 'mk-last mk-down-s'} />
        <g transform={`translate(${plotW + 2},${yP(last.c) - 9})`}>
          <rect width={PAD_R - 4} height={18} rx={3} className={lastUp ? 'mk-tag mk-up-f' : 'mk-tag mk-down-f'} />
          <text x={(PAD_R - 4) / 2} y={13} textAnchor="middle" className="mk-tag-t">
            {last.c.toFixed(2)}
          </text>
        </g>

        {/* volume */}
        {maxVol > 0 &&
          candles.map((c, i) => (
            <rect
              key={c.t}
              x={cx(i) - bw / 2}
              y={yVol0 + VOL_H - (c.vol / maxVol) * VOL_H}
              width={bw}
              height={Math.max(0, (c.vol / maxVol) * VOL_H)}
              className={c.c >= c.o ? 'mk-vol mk-up-f' : 'mk-vol mk-down-f'}
            />
          ))}
        <text x={4} y={yVol0 + 10} className="mk-note">
          Volume
        </text>

        {/* fee strip */}
        <line x1={0} x2={plotW} y1={yFee0 + FEE_H} y2={yFee0 + FEE_H} className="mk-grid" />
        {candles.map((c, i) => {
          const armed = c.fee > c.baseFee + 0.01
          const y = yFee(c.fee)
          return <rect key={c.t} x={cx(i) - bw / 2} y={y} width={bw} height={Math.max(1, yFee0 + FEE_H - y)} className={armed ? 'mk-fee mk-fee-armed' : 'mk-fee'} />
        })}
        <line x1={0} x2={plotW} y1={yFee(candles[0]!.baseFee)} y2={yFee(candles[0]!.baseFee)} className="mk-basefee" />
        <text x={4} y={yFee0 + 10} className="mk-note">
          Fee charged, bps (orange = surcharge)
        </text>
        <text x={W - 6} y={yFee(maxFee) + 4} textAnchor="end" className="mk-tick">
          {maxFee.toFixed(0)}
        </text>

        {/* time axis */}
        {candles.map((c, i) =>
          i % labelEvery === 0 ? (
            <text key={c.t} x={Math.max(cx(i), 30)} y={H - 6} textAnchor="middle" className="mk-tick">
              {hhmm(c.t)}
            </text>
          ) : null,
        )}

        {/* crosshair */}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={cx(hover)} x2={cx(hover)} y1={0} y2={H - AXIS_H} className="mk-cross" />
            <line x1={0} x2={plotW} y1={yP(d.c)} y2={yP(d.c)} className="mk-cross" />
          </g>
        )}
      </svg>
    </div>
  )
}
