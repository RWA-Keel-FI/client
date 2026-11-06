import { useMemo, useState } from 'react'
import { useMarket } from '../lib/market/context.ts'
import { usd } from '../lib/market/format.ts'
import { RESOLUTIONS, toCandles } from '../lib/market/history.ts'
import type { ResolutionId, Series } from '../lib/market/history.ts'
import { CandleChart } from './CandleChart.tsx'
import type { ChartStyle } from './CandleChart.tsx'

const MAX_CANDLES = 120

/** Header, controls and chart for one stock. Reads history from the engine, so it works for mock and anvil. */
export function StockChart({ sym, compact = false }: { sym: string; compact?: boolean }) {
  const { engine, state } = useMarket()
  const [series, setSeries] = useState<Series>('hook')
  const [res, setRes] = useState<ResolutionId>('1m')
  const [style, setStyle] = useState<ChartStyle>('candles')
  const [showRef, setShowRef] = useState(true)

  const sec = RESOLUTIONS.find((r) => r.id === res)?.sec ?? 60
  // The history buffer is mutated in place, so the engine state (new object per update) is the change signal.
  const candles = useMemo(
    () => (engine ? toCandles(engine.history(sym), sec, series).slice(-MAX_CANDLES) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, sym, sec, series, state],
  )

  const market = state.markets.find((m) => m.sym === sym)
  const first = candles[0]
  const last = candles[candles.length - 1]
  const change = first && last && first.o > 0 ? ((last.c - first.o) / first.o) * 100 : 0
  const price = last?.c ?? (market ? (series === 'hook' ? market.hook.priceUsd : market.control.priceUsd) : 0)
  const spanMin = first && last ? Math.round((last.t - first.t + sec) / 60) : 0

  return (
    <div className="panel mk-stock">
      <div className="mk-head">
        <div>
          <h2>
            t{sym} <span className="sub">{market?.name}</span>
          </h2>
          <p className="mk-price">
            <span>{price > 0 ? usd(price, 2) : '--'}</span>
            <span className={change >= 0 ? 'mk-up-t' : 'mk-down-t'}>
              {change >= 0 ? '+' : ''}
              {change.toFixed(2)}%
            </span>
            <span className="sub">
              {series === 'hook' ? 'hook pool' : 'control pool'}, last {spanMin} min{state.mode === 'mock' ? ' (simulated)' : ''}
            </span>
          </p>
        </div>
        <div className="mk-controls">
          <div className="controls" role="group" aria-label="Pool">
            <button type="button" aria-pressed={series === 'hook'} onClick={() => setSeries('hook')}>
              Hook
            </button>
            <button type="button" aria-pressed={series === 'control'} onClick={() => setSeries('control')}>
              Control
            </button>
          </div>
          <div className="controls" role="group" aria-label="Candle size">
            {RESOLUTIONS.map((r) => (
              <button key={r.id} type="button" aria-pressed={res === r.id} onClick={() => setRes(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="controls" role="group" aria-label="Chart style">
            <button type="button" aria-pressed={style === 'candles'} onClick={() => setStyle('candles')}>
              Candles
            </button>
            <button type="button" aria-pressed={style === 'line'} onClick={() => setStyle('line')}>
              Line
            </button>
          </div>
          <label className="inline">
            <input type="checkbox" checked={showRef} onChange={(e) => setShowRef(e.target.checked)} /> Reference
          </label>
        </div>
      </div>
      <CandleChart candles={candles} style={style} showRef={showRef} label={`t${sym} ${series} pool`} priceHeight={compact ? 220 : 300} />
    </div>
  )
}
