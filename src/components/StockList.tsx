import { useMarket } from '../lib/market/context.ts'
import { usd } from '../lib/market/format.ts'

function hue(sym: string): number {
  let h = 0
  for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <svg className="mk-spark" viewBox="0 0 100 30" aria-hidden="true" />
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - ((v - lo) / span) * 26).toFixed(1)}`).join(' ')
  return (
    <svg className="mk-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" className={up ? 'mk-up-s' : 'mk-down-s'} />
    </svg>
  )
}

/** Watchlist: one row per stock with price, change over the history window, sparkline and a surcharge badge. */
export function StockList({ sym, onSym }: { sym: string; onSym: (s: string) => void }) {
  const { engine, state } = useMarket()
  return (
    <ul className="mk-list" aria-label="Stocks">
      {state.markets.map((m) => {
        const h = engine?.history(m.sym) ?? []
        const win = h.slice(-360) // 120 simulated minutes, same window as the chart header
        const first = win[0]?.hook ?? m.hook.priceUsd
        const change = first > 0 ? ((m.hook.priceUsd - first) / first) * 100 : 0
        const armed = Math.max(m.hook.feeBuyBps, m.hook.feeSellBps) > m.hook.baseFeeBps + 0.01
        return (
          <li key={m.sym}>
            <button type="button" className="mk-row" aria-pressed={sym === m.sym} onClick={() => onSym(m.sym)} aria-label={`Show t${m.sym}`}>
              <span className="mk-avatar" style={{ background: `hsl(${hue(m.sym)} 55% 42%)` }} aria-hidden="true">
                {m.sym.slice(0, 2)}
              </span>
              <span className="mk-name">
                <strong>t{m.sym}</strong>
                <span className="sub">{m.name}</span>
              </span>
              <Spark values={win.map((s) => s.hook)} up={change >= 0} />
              <span className="mk-quote">
                <strong>{usd(m.hook.priceUsd, 2)}</strong>
                <span className={change >= 0 ? 'mk-up-t' : 'mk-down-t'}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(2)}%
                </span>
                {armed && <span className="mk-badge">surcharge</span>}
              </span>
            </button>
          </li>
        )
      })}
      {state.markets.length === 0 && <li className="sub">Loading markets...</li>}
    </ul>
  )
}
