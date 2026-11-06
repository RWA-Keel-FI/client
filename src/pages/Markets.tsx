import { useMemo, useState } from 'react'
import { useMarket } from '../lib/market/context.ts'
import { bps, usd } from '../lib/market/format.ts'
import type { MarketRow } from '../lib/market/types.ts'

/* Explore page, laid out like app.ondo.finance: hero banner, three leaderboards, then a filterable asset table. */

const CATEGORY: Record<string, string> = { NVDA: 'Technology', TSLA: 'Consumer', AAPL: 'Technology', META: 'Technology', GOOGL: 'Technology', SPY: 'ETF' }
const FILTERS = ['All assets', 'ETF', 'Technology', 'Consumer', 'Surcharged'] as const
type Filter = (typeof FILTERS)[number]
const SORTS = [
  { id: 'traded', label: 'Most traded' },
  { id: 'gainers', label: 'Top gainers' },
  { id: 'dev', label: 'Highest deviation' },
  { id: 'name', label: 'Name A-Z' },
] as const
type SortId = (typeof SORTS)[number]['id']

interface Row {
  m: MarketRow
  price: number
  chg: number
  pct: number
  vol: number
  armed: boolean
  fee: number
  spark: number[]
}

const hue = (sym: string) => {
  let h = 0
  for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function Avatar({ sym, size = 40 }: { sym: string; size?: number }) {
  return (
    <span className="ex-avatar" style={{ width: size, height: size, background: `hsl(${hue(sym)} 55% 42%)`, fontSize: size * 0.3 }} aria-hidden="true">
      {sym.slice(0, 2)}
    </span>
  )
}

function Spark({ values, up, w = 150, h = 40 }: { values: number[]; up: boolean; w?: number; h?: number }) {
  if (values.length < 2) return <svg width={w} height={h} aria-hidden="true" />
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - lo) / span) * (h - 8)] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg className={up ? 'ex-spark up' : 'ex-spark down'} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} className="area" />
      <polyline points={line} fill="none" className="line" />
    </svg>
  )
}

function Change({ pct, usdVal }: { pct: number; usdVal?: number }) {
  const up = pct >= 0
  return (
    <span className={up ? 'ex-chg up' : 'ex-chg down'}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {usdVal !== undefined ? usd(Math.abs(usdVal), 2) : `${Math.abs(pct).toFixed(2)}%`}
    </span>
  )
}

function FeePill({ r }: { r: Row }) {
  if (!r.m.sessionOpen) return <span className="ex-pill closed"><i /> Session closed</span>
  return r.armed ? (
    <span className="ex-pill armed"><i /> Surcharge {r.fee.toFixed(0)} bps</span>
  ) : (
    <span className="ex-pill open"><i /> Base fee {r.m.hook.baseFeeBps} bps</span>
  )
}

function Board({ title, chip, rows, sub, onTrade }: { title: string; chip: string; rows: Row[]; sub: (r: Row) => React.ReactNode; onTrade: (s: string) => void }) {
  return (
    <section className="ex-card" aria-label={title}>
      <h3>
        {title} <span className="ex-chip">{chip}</span>
      </h3>
      <ol>
        {rows.slice(0, 3).map((r) => (
          <li key={r.m.sym}>
            <button type="button" className="ex-boardrow" onClick={() => onTrade(r.m.sym)} aria-label={`Trade t${r.m.sym}`}>
              <Avatar sym={r.m.sym} />
              <span className="ex-id">
                <strong>t{r.m.sym}</strong>
                <span>{r.m.name}</span>
              </span>
              <span className="ex-val">
                <strong>{usd(r.price, 2)}</strong>
                {sub(r)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function Markets({ query, onTrade }: { query: string; onTrade: (sym: string) => void }) {
  const { engine, state } = useMarket()
  const [filter, setFilter] = useState<Filter>('All assets')
  const [sort, setSort] = useState<SortId>('traded')
  const [view, setView] = useState<'list' | 'grid'>('list')

  const rows: Row[] = useMemo(
    () =>
      state.markets.map((m) => {
        const h = (engine?.history(m.sym) ?? []).slice(-120)
        const first = h[0]?.hook ?? m.hook.priceUsd
        const price = m.hook.priceUsd
        return {
          m,
          price,
          chg: price - first,
          pct: first > 0 ? ((price - first) / first) * 100 : 0,
          vol: state.summary?.tickers[m.sym]?.hook.volumeUsd ?? 0,
          armed: Math.max(m.hook.feeBuyBps, m.hook.feeSellBps) > m.hook.baseFeeBps + 0.01,
          fee: Math.max(m.hook.feeBuyBps, m.hook.feeSellBps),
          spark: h.map((s) => s.hook),
        }
      }),
    // history is mutated in place; the state object changes on every engine update
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, state],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) => {
      if (q && !(`t${r.m.sym} ${r.m.name}`.toLowerCase().includes(q))) return false
      if (filter === 'Surcharged') return r.armed
      if (filter !== 'All assets') return CATEGORY[r.m.sym] === filter
      return true
    })
    const by: Record<SortId, (a: Row, b: Row) => number> = {
      traded: (a, b) => b.vol - a.vol,
      gainers: (a, b) => b.pct - a.pct,
      dev: (a, b) => b.m.hook.devBps - a.m.hook.devBps,
      name: (a, b) => a.m.sym.localeCompare(b.m.sym),
    }
    return list.sort(by[sort])
  }, [rows, query, filter, sort])

  const gainers = [...rows].sort((a, b) => b.pct - a.pct)
  const traded = [...rows].sort((a, b) => b.vol - a.vol)
  const deviated = [...rows].sort((a, b) => b.m.hook.devBps - a.m.hook.devBps)
  const open = state.markets[0]?.sessionOpen ?? true

  return (
    <section aria-label="Explore">
      <div className="ex-hero">
        <div className="ex-hero-copy">
          <h2>Fees that follow the market</h2>
          <p>Compare a hook pool against a flat-fee control pool, tick by tick.</p>
          <button type="button" onClick={() => onTrade(traded[0]?.m.sym ?? 'NVDA')}>
            Trade now
          </button>
        </div>
        <div className="ex-roll" aria-hidden="true">
          <div>
            {[0, 1].flatMap((k) => rows.map((r) => <span key={`${k}${r.m.sym}`}>t{r.m.sym}</span>))}
          </div>
        </div>
      </div>

      <div className="ex-cards">
        <Board title="Top Gainers" chip="2H" rows={gainers} onTrade={onTrade} sub={(r) => <Change pct={r.pct} />} />
        <Board title="Most Traded" chip="Volume" rows={traded} onTrade={onTrade} sub={(r) => <span className="ex-muted">{usd(r.vol, 0)}</span>} />
        <Board title="Highest Deviation" chip="Now" rows={deviated} onTrade={onTrade} sub={(r) => <span className="ex-muted">{bps(r.m.hook.devBps)}</span>} />
      </div>

      <div className="ex-table">
        <div className="ex-tabs">
          <span className="ex-tab on">
            Stocks &amp; ETFs <span className="ex-chip">{rows.length}</span>
          </span>
          <span className={open ? 'ex-status open' : 'ex-status'}>
            {open ? 'Market open' : 'Session closed'} <span className="ex-muted">({state.mode === 'mock' ? 'simulated' : 'local chain'})</span>
          </span>
        </div>

        <div className="ex-filters">
          <div className="ex-pills" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          <div className="ex-tools">
            <div className="ex-viewtoggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'list'} aria-label="List view" onClick={() => setView('list')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <button type="button" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
              </button>
            </div>
            <label className="ex-sort">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {view === 'list' ? (
          <div className="ex-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Asset name</th>
                  <th>Price</th>
                  <th>2H ($)</th>
                  <th>2H (%)</th>
                  <th>Volume</th>
                  <th>Deviation</th>
                  <th>Fee status</th>
                  <th>2H chart</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.m.sym} onClick={() => onTrade(r.m.sym)}>
                    <td className="ex-muted">{i + 1}</td>
                    <td>
                      <button type="button" className="ex-asset" onClick={() => onTrade(r.m.sym)} aria-label={`Trade t${r.m.sym}`}>
                        <Avatar sym={r.m.sym} size={44} />
                        <span className="ex-id">
                          <strong>t{r.m.sym}</strong>
                          <span>{r.m.name}</span>
                        </span>
                      </button>
                    </td>
                    <td className="ex-price">{usd(r.price, 2)}</td>
                    <td><Change pct={r.pct} usdVal={r.chg} /></td>
                    <td><Change pct={r.pct} /></td>
                    <td className="ex-price">{usd(r.vol, 0)}</td>
                    <td className="ex-mono">{bps(r.m.hook.devBps)}</td>
                    <td><FeePill r={r} /></td>
                    <td><Spark values={r.spark} up={r.pct >= 0} /></td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={9} className="ex-empty">No assets match.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ex-grid">
            {shown.map((r) => (
              <button key={r.m.sym} type="button" className="ex-tile" onClick={() => onTrade(r.m.sym)} aria-label={`Trade t${r.m.sym}`}>
                <span className="ex-tile-top">
                  <Avatar sym={r.m.sym} size={44} />
                  <span className="ex-id">
                    <strong>t{r.m.sym}</strong>
                    <span>{r.m.name}</span>
                  </span>
                </span>
                <span className="ex-tile-price">
                  <strong>{usd(r.price, 2)}</strong>
                  <Change pct={r.pct} />
                </span>
                <Spark values={r.spark} up={r.pct >= 0} w={260} h={60} />
                <FeePill r={r} />
              </button>
            ))}
            {shown.length === 0 && <p className="ex-empty">No assets match.</p>}
          </div>
        )}
      </div>

      <p className="ex-note">
        When the session is closed there is no live reference, so the hook charges the base fee and the issuer pauses minting and
        redeeming. The pools keep trading, which is the weekend case.
      </p>
    </section>
  )
}
