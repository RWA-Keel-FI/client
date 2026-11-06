import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { TICKERS } from '../lib/market/types.ts'
import { compactUsd, idx } from './landingData.ts'
import type { Headline } from './landingData.ts'
import { Globe } from './Globe.tsx'
import { Odometer } from './motion.tsx'
import { BRAND } from '../brand.ts'

const hue = (sym: string) => {
  let h = 0
  for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/* ============================================================== bento dashboard */

const TABS: { id: string; name: string; blurb: string; cta: string; icon: ReactNode }[] = [
  {
    id: 'trade',
    name: 'Trade',
    blurb: 'Swap tokenized stocks against USDC in a Uniswap v4 pool whose fee reacts to how far the pool has drifted from the stock price.',
    cta: 'Discover Trade',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 12h18l-4-4M26 20H8l4 4" />
      </svg>
    ),
  },
  {
    id: 'mint',
    name: 'Mint & Redeem',
    blurb: 'Create or retire stock tokens at the reference price through the issuer. It is the anchor that keeps the pools honest.',
    cta: 'Discover Mint & Redeem',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="16" cy="16" r="10" />
        <path d="M16 11v10M11 16h10" />
      </svg>
    ),
  },
  {
    id: 'lp',
    name: 'Liquidity',
    blurb: 'Provide liquidity and keep more of what informed traders would otherwise take. The surcharge flows back to LPs.',
    cta: 'Discover Liquidity',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 5c5 6 8 9.5 8 13a8 8 0 0 1-16 0c0-3.500 3-7 8-13z" />
      </svg>
    ),
  },
]

/** Fee vs deviation from the contract rule: fee = clamp(max(f0, K * d_eff)), d_eff = max(0, d - dead band). Drawn as dots. */
function feeCurve(n: number) {
  const F0 = 30
  const FMAX = 200
  const K = 0.5
  const BAND = 120
  const MAX_DEV = 560
  return Array.from({ length: n }, (_, i) => {
    const dev = (i / (n - 1)) * MAX_DEV
    const fee = Math.min(FMAX, Math.max(F0, K * Math.max(0, dev - BAND)))
    return { x: i / (n - 1), y: fee / FMAX }
  })
}

function DotChart() {
  const pts = useMemo(() => feeCurve(36), [])
  const W = 600
  const H = 230
  return (
    <div className="lp-dotchart" data-reveal="fade-move" style={idx(1)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fee rises with deviation: flat at the base fee, then linear, then capped">
        {Array.from({ length: 14 }, (_, k) => (
          <line key={k} x1={0} x2={W} y1={10 + k * 16.5} y2={10 + k * 16.5} className="lp-dotgrid" />
        ))}
        {pts.map((p, i) => (
          <rect key={i} x={p.x * (W - 14)} y={10 + (1 - p.y) * (H - 34)} width={9} height={9} rx={2} className="lp-dot" style={idx(i)} />
        ))}
      </svg>
      <span className="lp-tag-mono">200 bps cap</span>
    </div>
  )
}

function Bars({ h }: { h: Headline }) {
  const bars = [
    { label: 'Small swaps', v: h.smallSurchargedPct, c: '#dce8ff' },
    { label: 'All swaps', v: h.surchargedPct, c: '#b3cdf7' },
    { label: 'Volume', v: h.volSurchargedPct, c: '#8ba9ee' },
    { label: 'LP revenue', v: h.upliftPct, c: '#5a82cf' },
  ]
  const max = Math.max(...bars.map((b) => b.v), 1)
  return (
    <div className="lp-bars" data-reveal="odo">
      {bars.map((b, i) => (
        <div key={b.label} className="lp-bar-col" style={idx(i)}>
          <span className="lp-bar-val">{b.v.toFixed(1)}%</span>
          <span className="lp-bar" style={{ '--h': `${Math.max(8, (b.v / max) * 100)}%`, background: b.c } as CSSProperties} />
          <span className="lp-bar-label">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Bento({ h, onLaunch }: { h: Headline; onLaunch: (e: React.MouseEvent) => void }) {
  const [tab, setTab] = useState(0)
  const cur = TABS[tab]!
  return (
    <div className="lp-bento" data-reveal="fade-move">
      <div className="lp-bento-left">
        {TABS.map((t, i) =>
          i === tab ? (
            <article key={t.id} className="lp-tab-card" aria-label={t.name}>
              <span className="lp-tab-icon" aria-hidden="true">{t.icon}</span>
              <div className="lp-tab-body">
                <h3>{t.name}</h3>
                <p className="lp-serif">{cur.blurb}</p>
                <span className="lp-chip">Test tokens only</span>
              </div>
              <div className="lp-tab-foot">
                <span className="lp-avatars" aria-hidden="true">
                  {TICKERS.slice(0, 3).map((s) => (
                    <i key={s.sym} style={{ background: `hsl(${hue(s.sym)} 55% 42%)` }}>{s.sym.slice(0, 2)}</i>
                  ))}
                </span>
                <a className="lp-btn" href="/app" onClick={onLaunch}>{t.cta}</a>
              </div>
            </article>
          ) : (
            <button key={t.id} type="button" className="lp-tab" aria-expanded="false" onClick={() => setTab(i)}>
              {t.name}
            </button>
          ),
        )}
      </div>

      <div className="lp-bento-right">
        <section className="lp-metric lp-metric-wide" aria-label="LP revenue uplift">
          <div>
            <p className="lp-metric-label">LP revenue uplift</p>
            <p className="lp-metric-num lp-serif"><Odometer value={`+${h.upliftPct.toFixed(1)}%`} /></p>
            <p className="lp-metric-sub">Backtest, core pools</p>
          </div>
          <DotChart />
        </section>

        <section className="lp-metric" aria-label="Stocks in the simulator">
          <p className="lp-metric-label">Stocks in the simulator</p>
          <p className="lp-metric-num lp-serif"><Odometer value={String(TICKERS.length)} /></p>
          <div className="lp-stock-grid">
            {TICKERS.map((s, i) => (
              <span key={s.sym} className="lp-stock" data-reveal="fade-move" style={idx(i)}>
                <i style={{ background: `hsl(${hue(s.sym)} 55% 42%)` }}>{s.sym.slice(0, 2)}</i>
                <b>t{s.sym}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="lp-metric" aria-label="Who pays the surcharge">
          <p className="lp-metric-label">Swaps surcharged</p>
          <p className="lp-metric-num lp-serif"><Odometer value={`${h.surchargedPct.toFixed(1)}%`} /></p>
          <Bars h={h} />
        </section>
      </div>
    </div>
  )
}

/* ============================================================== big-number rows */

export function Foundation({ h }: { h: Headline }) {
  const rows = [
    { v: h.swaps.toLocaleString('en-US'), l: ['Swaps', 'replayed'] },
    { v: compactUsd(h.volume), l: ['Volume', 'replayed'] },
    { v: `+${h.upliftPct.toFixed(1)}%`, l: ['LP fee', 'revenue'] },
  ]
  return (
    <div className="lp-found">
      <h2 className="lp-found-h">
        <span className="lp-mask"><span data-reveal="mask">{BRAND} is building the foundation</span></span>
        <span className="lp-mask"><span data-reveal="mask" style={idx(1)} className="lp-grey-t">for fairer pools.</span></span>
      </h2>
      <div className="lp-rows">
        {rows.map((r, i) => (
          <div key={r.l.join()} className="lp-row" data-reveal="fade-move" style={idx(i)}>
            <strong className="lp-big"><Odometer value={r.v} /></strong>
            <span className="lp-row-label lp-serif">
              {r.l[0]}
              <br />
              {r.l[1]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============================================================== beliefs: dotted disc + 01/02/03 */

const BELIEFS = [
  { word: 'Fair Fees', body: 'Swaps that move the pool away from the reference never see a surcharge. In the backtest, zero non-arbitrage swaps were surcharged.' },
  { word: 'Honest Pools', body: 'The people who profit from a stale pool price share that profit with the LPs who carried the risk, so the pool tracks the real stock price.' },
  { word: 'Shared Upside', body: 'One formula, integer math in the contract and a floating-point twin in the UI. No hidden parameters and no discretionary switches.' },
]
const ROTATE_MS = 6000
const RING = 2 * Math.PI * 19

export function Beliefs({ reduced }: { reduced: boolean }) {
  const [i, setI] = useState(0)
  const [inView, setInView] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // auto-advance every 6s (same cadence as the progress ring); stops off-screen and with reduced motion
  useEffect(() => {
    if (reduced || !inView) return
    const t = window.setTimeout(() => setI((x) => (x + 1) % BELIEFS.length), ROTATE_MS)
    return () => window.clearTimeout(t)
  }, [i, inView, reduced])

  const b = BELIEFS[i]!
  return (
    <div className="lp-bel" ref={root}>
      <Globe spinKey={i} active={inView} reduced={reduced} />
      <div className="lp-bel-left">
        <p className="lp-bel-eyebrow">A message from the builders</p>
        <h2 className="lp-bel-h">We Believe In</h2>
      </div>
      <h3 className="lp-bel-word" aria-live="polite">
        <span className="lp-mask">
          <span key={i} className="lp-swap">{b.word}</span>
        </span>
      </h3>
      <p key={`p${i}`} className="lp-bel-body lp-serif lp-fade">{b.body}</p>
      <div className="lp-bel-pills" role="tablist" aria-label="Beliefs">
        {BELIEFS.map((x, k) => (
          <button key={x.word} type="button" role="tab" aria-selected={k === i} aria-label={x.word} className={k === i ? 'lp-pillnum on' : 'lp-pillnum'} onClick={() => setI(k)}>
            {k === i && !reduced && inView && (
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <circle key={i} cx="22" cy="22" r="19" className="lp-ring" style={{ strokeDasharray: RING, animationDuration: `${ROTATE_MS}ms` }} />
              </svg>
            )}
            {String(k + 1).padStart(2, '0')}
          </button>
        ))}
      </div>
    </div>
  )
}
