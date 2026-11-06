import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { HeroStage } from './HeroStage.tsx'
import { FALLBACK, idx } from './landingData.ts'
import type { Headline } from './landingData.ts'
import { Lines } from './motion.tsx'
import { Beliefs, Bento, Foundation } from './Sections.tsx'
import { loadBacktest } from '../lib/results.ts'
import './landing.css'
import { BRAND } from '../brand.ts'

interface Props {
  onLaunch: () => void
}

const TICKER = ['NVDAon / USDC', 'TSLAon / USDC', 'SPYon / USDC', 'Uniswap v4 hook', 'Base fee 0.30%', 'Fee cap 2.00%', 'Arb-direction only']

const NAV = [
  { href: '#products', label: 'Product' },
  { href: '#how', label: 'How it works' },
  { href: '#results', label: 'Results' },
  { href: '#principles', label: 'Principles' },
]

const STEPS = [
  { n: '01', title: 'Measure the gap', body: 'Compare the pool price with the reference price for the stock. d = |pool / ref - 1|.' },
  { n: '02', title: 'Discount the noise', body: 'Subtract what normal volatility explains over the age of the reference. d_eff = max(0, d - σ√age).' },
  { n: '03', title: 'Charge arbitrageurs', body: 'If the swap pushes the pool toward ref, fee = max(f0, d_eff / 2). Every other swap pays f0.' },
]

function CurveArt() {
  // Fee vs deviation: flat f0 inside the dead band, then rising at slope 1/2, capped at fMax.
  return (
    <svg className="lp-curve" viewBox="0 0 560 300" role="img" aria-label="Fee as a function of deviation: flat at the base fee, then rising linearly until it reaches the cap">
      <rect x="20" y="20" width="520" height="250" rx="20" className="lp-curve-bg" />
      <rect x="20" y="20" width="110" height="250" className="lp-curve-band" />
      <line x1="20" y1="210" x2="540" y2="210" className="lp-curve-grid" />
      <line x1="20" y1="90" x2="540" y2="90" className="lp-curve-grid" />
      <path d="M20 210 H130 L420 90 H540" className="lp-curve-line" fill="none" />
      <circle cx="130" cy="210" r="6" className="lp-curve-dot" />
      <circle cx="420" cy="90" r="6" className="lp-curve-dot" />
      <text x="32" y="198" className="lp-curve-t">f0 base fee</text>
      <text x="436" y="78" className="lp-curve-t">fMax cap</text>
      <text x="32" y="44" className="lp-curve-t">noise dead band</text>
      <text x="520" y="260" textAnchor="end" className="lp-curve-t">deviation →</text>
    </svg>
  )
}

export function Landing({ onLaunch }: Props) {
  const [h, setH] = useState<Headline>(FALLBACK)
  const [scrolled, setScrolled] = useState(false)
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  // Ondo-style hero: collapsed = full-bleed video, open = white page with the nested video squares.
  const [open, setOpenState] = useState(reduced)
  const [instant, setInstant] = useState(false)
  const setOpen = useCallback((v: boolean, now = false) => {
    if (now) {
      setInstant(true)
      window.setTimeout(() => setInstant(false), 80)
    }
    setOpenState(v)
  }, [])
  useEffect(() => {
    let alive = true
    void loadBacktest().then((r) => {
      const s = r?.pooled_core_baseline
      if (!alive || !s) return
      setH({
        upliftPct: s.delta_pct,
        swaps: s.swaps,
        volume: s.volume,
        surchargedPct: s.pct_swaps_surcharged,
        nonArb: s.nonarb_swaps_surcharged,
        volSurchargedPct: s.pct_volume_surcharged,
        smallSurchargedPct: s.pct_small_swaps_surcharged,
      })
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.lp [data-reveal]')
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'))
      return
    }
    // A masked line starts translated out of its overflow:hidden parent, so it is "clipped" and would
    // never intersect. Observe the mask wrapper instead and reveal its child.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const t = e.target as HTMLElement
          if (t.hasAttribute('data-reveal')) t.classList.add('in')
          else t.querySelectorAll(':scope > [data-reveal]').forEach((c) => c.classList.add('in'))
          io.unobserve(t)
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
    )
    const seen = new Set<Element>()
    els.forEach((el) => {
      const target = el.getAttribute('data-reveal') === 'mask' ? el.parentElement! : el
      if (seen.has(target)) return
      seen.add(target)
      io.observe(target)
    })
    return () => io.disconnect()
  }, [])

  const launch = (e: MouseEvent) => {
    e.preventDefault()
    onLaunch()
  }

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to main content</a>

      <header className={`lp-nav${open ? '' : ' lp-nav--over'}${scrolled && open ? ' scrolled' : ''}${instant ? ' is-instant' : ''}`}>
        <a className="lp-logo" href="/" aria-label={`${BRAND} home`}>
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M5 16 L10 16 L15 8 L21 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{BRAND}</span>
        </a>
        <nav aria-label="Primary" className="lp-links">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>{n.label}</a>
          ))}
        </nav>
        <a className={open ? 'lp-pill lp-pill-dark' : 'lp-pill lp-pill-light'} href="/app" onClick={launch}>Launch App</a>
      </header>

      <main id="main">
        <HeroStage open={open} reduced={reduced} setOpen={setOpen} instant={instant} />

        <div className="lp-ticker" aria-label="Pools and parameters">
          <div className="lp-ticker-track">
            {[0, 1, 2].map((k) => (
              <ul key={k} aria-hidden={k > 0 ? 'true' : undefined}>
                {TICKER.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* LATEST / HIGHLIGHT CARDS */}
        <section className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2"><Lines lines={['See the latest', `from ${BRAND}`]} /></h2>
            <div className="lp-cards3">
              <article className="lp-card" data-reveal="fade-move" style={idx(0)}>
                <p className="lp-tag">Backtest</p>
                <h3>+{h.upliftPct.toFixed(1)}% LP revenue on real Ondo-token swaps</h3>
                <a href="#results">Read more →</a>
              </article>
              <article className="lp-card" data-reveal="fade-move" style={idx(1)}>
                <p className="lp-tag">Design</p>
                <h3>Only arbitrage-direction swaps are surcharged</h3>
                <a href="#how">Read more →</a>
              </article>
              <article className="lp-card" data-reveal="fade-move" style={idx(2)}>
                <p className="lp-tag">Simulator</p>
                <h3>Replay it in the browser or against a local anvil chain</h3>
                <a href="/app" onClick={launch}>Open dashboard →</a>
              </article>
            </div>
          </div>
        </section>

        {/* PRODUCTS: bento dashboard */}
        <section className="lp-section lp-section-tight" id="products">
          <div className="lp-wrap">
            <p className="lp-eyebrow dark">The product</p>
            <h2 className="lp-h2"><Lines lines={['A new standard', 'for onchain stock liquidity.']} /></h2>
            <p className="lp-sub">Three surfaces, one rule, all running on test tokens.</p>
            <Bento h={h} onLaunch={launch} />
          </div>
        </section>

        {/* STATS */}
        <section className="lp-section lp-found-sec" id="results">
          <div className="lp-wrap">
            <Foundation h={h} />
            <p className="lp-fine">
              Backtest of real Ondo-token swaps on Ethereum, core pools (NVDAon, TSLAon), against the fee rule. Not live, not on a
              testnet, not a forecast. See the Backtest tab in the app for the full table and sensitivities.
            </p>
          </div>
        </section>

        {/* HOW */}
        <section className="lp-section" id="how">
          <div className="lp-wrap lp-how">
            <div>
              <p className="lp-eyebrow dark">How it works</p>
              <h2 className="lp-h2"><Lines lines={['Our rule,', 'your pool.']} /></h2>
              <p className="lp-sub">
                <code>fee = max(f0, d_eff / 2)</code> on arbitrage-direction swaps, <code>f0</code> otherwise, clamped to the cap.
              </p>
              <ol className="lp-steps">
                {STEPS.map((s, i) => (
                  <li key={s.n} data-reveal="fade-move" style={idx(i)}>
                    <span>{s.n}</span>
                    <div>
                      <h3>{s.title}</h3>
                      <p>{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div data-reveal="fade-move" style={idx(1)}><CurveArt /></div>
          </div>
        </section>

        {/* BELIEFS */}
        <section className="lp-section lp-bel-sec" id="principles">
          <div className="lp-wrap">
            <Beliefs reduced={reduced} />
          </div>
        </section>

        {/* CTA */}
        <section className="lp-cta">
          <div className="lp-wrap">
            <h2 className="lp-h2 light"><Lines lines={['Watch the fee move.']} /></h2>
            <p className="lp-sub light" data-reveal="rise">Play a replay, shock a price, and see which swaps pay the surcharge, and why.</p>
            <a className="lp-pill lp-pill-light lp-pill-lg" href="/app" onClick={launch}>Launch App</a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-foot-grid">
          <div>
            <a className="lp-logo" href="/" aria-label={`${BRAND} home`}>
              <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M5 16 L10 16 L15 8 L21 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{BRAND}</span>
            </a>
            <p className="lp-foot-note">Dynamic-fee Uniswap v4 hook for tokenized-stock pools. Test tokens only. Not investment advice.</p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="/app" onClick={launch}>Trade</a>
            <a href="/app" onClick={launch}>Mint &amp; Redeem</a>
            <a href="/app" onClick={launch}>Liquidity</a>
          </div>
          <div>
            <h4>Learn</h4>
            <a href="#how">How it works</a>
            <a href="#results">Backtest</a>
            <a href="#principles">Principles</a>
          </div>
        </div>
        <div className="lp-wrap lp-foot-bottom">
          <span>© 2026 {BRAND}</span>
          <span>Design inspired by ondo.finance. Not affiliated.</span>
        </div>
      </footer>
    </div>
  )
}
