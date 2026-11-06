import { useEffect, useMemo, useState } from 'react'
import { explain, REASON_TEXT } from '../lib/fee.ts'
import { useMarket } from '../lib/market/context.ts'
import { bps, qty, shortHash, signedUsd, usd } from '../lib/market/format.ts'
import { AssetChart } from '../components/AssetChart.tsx'
import type { PoolKind, Quote, Side, TradeResult } from '../lib/market/types.ts'
import { BRAND } from '../brand.ts'

function whyText(q: Quote): string {
  if (q.pool === 'control') return 'Control pool: a flat fee, no reference price check.'
  if (q.reason === 'surcharge') {
    return explain({ reason: q.reason, deviationBps: q.devBps, baseFeeBps: q.baseFeeBps, chargedFeeBps: q.feeBps })
  }
  return REASON_TEXT[q.reason]
}

export function Trade({ sym, onSym }: { sym: string; onSym: (s: string) => void }) {
  const { engine, state } = useMarket()
  const [pool, setPool] = useState<PoolKind>('hook')
  const [side, setSide] = useState<Side>('buy')
  const [amount, setAmount] = useState('1000')
  const [slip, setSlip] = useState('0.5')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [qErr, setQErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TradeResult | null>(null)

  const amt = Number(amount)
  const slipN = Number(slip)
  const have = state.wallet.tokens[sym] ?? 0
  const market = state.markets.find((m) => m.sym === sym)
  const simTs = state.sim.simTs
  const marketKey = market ? `${market.hook.priceUsd}|${market.hook.feeBuyBps}|${market.hook.feeSellBps}|${market.refPriceUsd}` : ''

  useEffect(() => {
    if (!engine || !(amt > 0)) return
    let live = true
    engine
      .quote(sym, pool, side, amt, Number.isFinite(slipN) ? slipN : 0.5)
      .then((q) => {
        if (!live) return
        setQuote(q)
        setQErr('')
      })
      .catch((e: unknown) => {
        if (live) setQErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      live = false
    }
  }, [engine, sym, pool, side, amt, slipN, simTs, marketKey])

  const shown = amt > 0 ? quote : null
  const err = amt > 0 ? qErr : ''

  const holdings = useMemo(
    () =>
      state.markets.map((m) => {
        const b = state.wallet.basis[m.sym] ?? { qty: 0, costUsd: 0, realizedUsd: 0 }
        const q = state.wallet.tokens[m.sym] ?? 0
        const value = q * m.refPriceUsd
        const cost = q > 0 && b.qty > 0 ? (b.costUsd / b.qty) * q : 0
        return { sym: m.sym, q, value, avg: b.qty > 0 ? b.costUsd / b.qty : 0, unreal: q > 0 ? value - cost : 0, realized: b.realizedUsd }
      }),
    [state.markets, state.wallet],
  )
  const totalUnreal = holdings.reduce((a, h) => a + h.unreal, 0)
  const totalReal = holdings.reduce((a, h) => a + h.realized, 0)

  async function confirm() {
    if (!engine || !shown) return
    setBusy(true)
    setResult(null)
    const r = await engine.trade(sym, pool, side, amt, Number.isFinite(slipN) ? slipN : 0.5, shown.minOut)
    setResult(r)
    setBusy(false)
  }

  const unitIn = side === 'buy' ? 'tUSDC' : `t${sym}`
  const unitOut = side === 'buy' ? `t${sym}` : 'tUSDC'
  const insufficient = side === 'buy' ? amt > state.wallet.usdc : amt > have
  const cheaper = shown ? shown.amountOut - shown.otherPoolOut : 0
  const hue = (() => {
    let h = 0
    for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 360
    return h
  })()
  const hi = market ? Math.max(market.hook.feeBuyBps, market.hook.feeSellBps) : 0

  return (
    <section aria-label="Trade" className="at">
      <div className="at-stocks" role="group" aria-label="Stock">
        {(engine?.syms ?? []).map((s) => (
          <button key={s} type="button" aria-pressed={s === sym} onClick={() => onSym(s)}>
            t{s}
          </button>
        ))}
      </div>

      <div className="at-layout">
        <div className="at-main">
          <header className="at-title">
            <span className="at-avatar" style={{ background: `hsl(${hue} 55% 42%)` }} aria-hidden="true">{sym.slice(0, 2)}</span>
            <h2>
              {market?.name ?? sym} <span className="at-ticker">t{sym}</span>
            </h2>
            <span className={market?.sessionOpen ? 'at-badge open' : 'at-badge'}>
              <i aria-hidden="true" /> {market?.sessionOpen ? 'Asset open for trade' : 'Session closed: reference frozen'}
            </span>
          </header>

          <AssetChart sym={sym} />

          <section className="at-about" aria-label="About">
            <h3>About</h3>
            <p>
              t{sym} is a test token that tracks {market?.name ?? sym} inside the {BRAND} simulator. It trades against tUSDC in two
              pools: a hook pool whose fee follows the oracle reference price, and a control pool with a flat fee.{' '}
              {state.mode === 'mock' ? 'Prices here are simulated; nothing is real money or real stock.' : 'Data is read from your local chain.'}
            </p>
            {market && (
              <div className="at-facts">
                <dl>
                  <div><dt>Underlying asset</dt><dd>{market.name}</dd></div>
                  <div><dt>Underlying ticker</dt><dd>{sym}</dd></div>
                  <div><dt>Category</dt><dd><span className="at-chip">Equities</span> <span className="at-chip">Test token</span></dd></div>
                  <div><dt>Base fee</dt><dd>{market.hook.baseFeeBps} bps</dd></div>
                </dl>
                <dl>
                  <div><dt>Oracle reference</dt><dd>{usd(market.refPriceUsd, 2)}</dd></div>
                  <div><dt>Hook pool price</dt><dd>{usd(market.hook.priceUsd, 2)} ({bps(market.hook.devBps)} apart)</dd></div>
                  <div><dt>Hook fee buy / sell</dt><dd className={hi > market.hook.baseFeeBps + 0.01 ? 'surcharge' : undefined}>{market.hook.feeBuyBps.toFixed(0)} / {market.hook.feeSellBps.toFixed(0)} bps</dd></div>
                  <div><dt>Hook pool TVL</dt><dd>{usd(market.hook.tvlUsd)}</dd></div>
                </dl>
              </div>
            )}
          </section>
        </div>

        <aside className="at-trade" aria-label="Order">
          <div className="at-trade-head">
            <h3>{side === 'buy' ? 'Buy' : 'Sell'} t{sym}</h3>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void confirm()
            }}
          >
            <div className="at-trade-bar">
              <div className="at-seg small" role="group" aria-label="Side">
                <button type="button" aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>Buy</button>
                <button type="button" aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>Sell</button>
              </div>
              <label className="at-select">
                <span className="sr-only">Pool</span>
                <select value={pool} onChange={(e) => setPool(e.target.value as PoolKind)}>
                  <option value="hook">Hook pool</option>
                  <option value="control">Control pool (flat fee)</option>
                </select>
              </label>
            </div>

            <div className="at-swap">
              <label className="at-leg">
                <span className="at-leg-label">Spend</span>
                <span className="at-leg-row">
                  <input type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount to spend in ${unitIn}`} />
                  <span className="at-token">{unitIn}</span>
                </span>
                <span className="sub">Balance: {side === 'buy' ? `${usd(state.wallet.usdc, 2)} tUSDC` : `${qty(have)} t${sym}`}</span>
              </label>
              <button type="button" className="at-flip" aria-label="Switch buy and sell" onClick={() => setSide(side === 'buy' ? 'sell' : 'buy')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
              </button>
              <div className="at-leg" aria-live="polite">
                <span className="at-leg-label">Receive</span>
                <span className="at-leg-row">
                  <output className={shown ? 'at-out' : 'at-out empty'}>{shown ? qty(shown.amountOut, 6) : '0'}</output>
                  <span className="at-token">{unitOut}</span>
                </span>
                <span className="sub">{shown ? `Minimum ${qty(shown.minOut, 6)} after slippage` : 'Enter an amount for a live quote'}</span>
              </div>
            </div>

            <button type="submit" className="at-go" disabled={busy || !shown || !(amt > 0) || insufficient}>
              {busy ? 'Confirming...' : `${side === 'buy' ? 'Buy' : 'Sell'} t${sym}`}
            </button>
            {insufficient && amt > 0 && (
              <p role="alert" className="err">
                {side === 'buy' ? 'Not enough tUSDC. Use the faucet on the Mint & redeem page.' : `You do not hold that much t${sym}.`}
              </p>
            )}
          </form>

          {err && <p role="alert" className="err">{err}</p>}
          {shown && (
            <div className="at-quote">
              <dl className="kv">
                <dt>Fee</dt>
                <dd className={shown.armed ? 'surcharge' : undefined}>
                  {shown.feeBps.toFixed(1)} bps = {usd(shown.feeUsd, 2)}{shown.armed ? ' SURCHARGE' : ''}
                </dd>
                <dt>Execution price</dt>
                <dd>{usd(shown.execPriceUsd, 2)} (impact {bps(shown.priceImpactBps)})</dd>
                <dt>Pool / reference</dt>
                <dd>{usd(shown.midPriceUsd, 2)} / {usd(shown.refPriceUsd, 2)}</dd>
                <dt>Direction</dt>
                <dd>{shown.towardRef ? 'Toward the reference' : 'Away from the reference'}</dd>
              </dl>
              <p className="why-box">{whyText(shown)}</p>
              <p className="sub">
                Same trade in the {shown.pool === 'hook' ? 'control' : 'hook'} pool: {qty(shown.otherPoolOut, 6)} {unitOut}. This pool gives you{' '}
                {cheaper >= 0 ? 'more' : 'less'} by {qty(Math.abs(cheaper), 6)} {unitOut}.
              </p>
            </div>
          )}
          <label className="at-slip">
            Slippage tolerance (%)
            <input type="number" min="0" step="0.1" inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} />
          </label>
          {result && (
            <div role="status" className={result.ok ? 'result ok' : 'result bad'}>
              {result.ok ? (
                <>
                  Trade confirmed{result.filledOut !== undefined ? `: received ${qty(result.filledOut, 6)} ${unitOut}` : ''}. Tx <code>{shortHash(result.hash ?? '')}</code>
                  {state.mode === 'mock' ? ' (mock hash, no chain)' : ''}
                </>
              ) : (
                <>Not executed: {result.error}</>
              )}
            </div>
          )}
          <p className="at-legal">
            Test tokens only. This is spot trading, so you cannot short. Nothing here is real money, real stock or investment advice.
          </p>
        </aside>
      </div>

      <h2>Your positions</h2>
      <p className="sub">
        tUSDC {usd(state.wallet.usdc, 2)}. Marked at the oracle reference price. Unrealized {signedUsd(totalUnreal)}, realized {signedUsd(totalReal)}.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th className="num">Quantity</th>
              <th className="num">Average cost</th>
              <th className="num">Value</th>
              <th className="num">Unrealized P&amp;L</th>
              <th className="num">Realized P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.sym}>
                <td>t{h.sym}</td>
                <td className="num">{qty(h.q)}</td>
                <td className="num">{h.q > 0 ? usd(h.avg, 2) : '-'}</td>
                <td className="num">{h.q > 0 ? usd(h.value, 2) : '-'}</td>
                <td className="num">{h.q > 0 ? signedUsd(h.unreal) : '-'}</td>
                <td className="num">{h.realized !== 0 ? signedUsd(h.realized) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
