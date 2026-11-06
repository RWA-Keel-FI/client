import { useMemo, useState } from 'react'
import { useMarket } from '../lib/market/context.ts'
import { usd } from '../lib/market/format.ts'
import { toCandles } from '../lib/market/history.ts'
import type { Series } from '../lib/market/history.ts'
import { CandleChart } from './CandleChart.tsx'
import type { ChartStyle } from './CandleChart.tsx'

const RANGES = [
  { id: '30m', label: '30M', n: 30 },
  { id: '1h', label: '1H', n: 60 },
  { id: '2h', label: '2H', n: 120 },
] as const
type RangeId = (typeof RANGES)[number]['id']

/** Asset-page price card: big price, change, range tabs and a tinted chart. Green when the window is up, red when down. */
export function AssetChart({ sym }: { sym: string }) {
  const { engine, state } = useMarket()
  const [range, setRange] = useState<RangeId>('2h')
  const [series, setSeries] = useState<Series>('hook')
  const [style, setStyle] = useState<ChartStyle>('line')
  const [showRef, setShowRef] = useState(true)

  const n = RANGES.find((r) => r.id === range)?.n ?? 120
  const candles = useMemo(
    () => (engine ? toCandles(engine.history(sym), 60, series).slice(-n) : []),
    // history is mutated in place; the engine state object changes on every update
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, sym, series, n, state],
  )
  const first = candles[0]
  const last = candles[candles.length - 1]
  const delta = first && last ? last.c - first.o : 0
  const pct = first && first.o > 0 ? (delta / first.o) * 100 : 0
  const up = delta >= 0

  return (
    <section className={up ? 'at-chart up' : 'at-chart down'} aria-label={`t${sym} price`}>
      <div className="at-chart-head">
        <div>
          <p className="at-price">{last ? usd(last.c, 2) : '--'}</p>
          <p className={up ? 'at-change mk-up-t' : 'at-change mk-down-t'}>
            <span aria-hidden="true">{up ? '▲' : '▼'}</span> {usd(Math.abs(delta), 2)} ({Math.abs(pct).toFixed(2)}%) {range.toUpperCase()}
          </p>
        </div>
        <div className="at-seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <CandleChart candles={candles} style={style} showRef={showRef} label={`t${sym} ${series} pool`} priceHeight={300} trend={up ? 'up' : 'down'} />
      <div className="at-chart-foot">
        <div className="at-seg" role="group" aria-label="Pool">
          <button type="button" aria-pressed={series === 'hook'} onClick={() => setSeries('hook')}>Hook pool</button>
          <button type="button" aria-pressed={series === 'control'} onClick={() => setSeries('control')}>Control pool</button>
        </div>
        <div className="at-seg" role="group" aria-label="Chart style">
          <button type="button" aria-pressed={style === 'line'} onClick={() => setStyle('line')}>Line</button>
          <button type="button" aria-pressed={style === 'candles'} onClick={() => setStyle('candles')}>Candles</button>
        </div>
        <label className="inline">
          <input type="checkbox" checked={showRef} onChange={(e) => setShowRef(e.target.checked)} /> Oracle reference
        </label>
        <span className="sub">Pool reads since you opened this page (Arc Testnet, every few seconds)</span>
      </div>
    </section>
  )
}
