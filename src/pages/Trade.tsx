import { useEffect, useMemo, useState } from 'react'
import { explain, REASON_TEXT } from '../lib/fee.ts'
import { useMarket } from '../lib/market/context.ts'
import { bps, qty, usd } from '../lib/market/format.ts'
import { AssetChart } from '../components/AssetChart.tsx'
import { TxStatus, useTx } from '../components/Tx.tsx'
import { ActionGate, useCanTransact } from '../components/WalletButton.tsx'
import type { PoolKind, Quote, Side } from '../lib/market/types.ts'
import { ARC_EXPLORER } from '../lib/chain/arc.ts'

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
  const tx = useTx()
  const canTx = useCanTransact()

  const amt = Number(amount)
  const slipN = Number(slip)
  const have = state.wallet.tokens[sym] ?? 0
  const market = state.markets.find((m) => m.sym === sym)
  const simTs = state.chainTs
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
        const q = state.wallet.tokens[m.sym] ?? 0
        return { sym: m.sym, q, value: q * m.refPriceUsd }
      }),
    [state.markets, state.wallet],
  )
  const totalValue = holdings.reduce((a, h) => a + h.value, 0)

  async function confirm() {
    if (!engine || !shown) return
    await tx.run((onStep) => engine.trade(sym, pool, side, amt, Number.isFinite(slipN) ? slipN : 0.5, shown.minOut, onStep))
  }

  const unitIn = side === 'buy' ? 'USDC' : `t${sym}`
  const unitOut = side === 'buy' ? `t${sym}` : 'USDC'
  const insufficient = canTx && (side === 'buy' ? amt > state.wallet.usdc : amt > have)
  const cheaper = shown && shown.otherPoolOut !== null ? shown.amountOut - shown.otherPoolOut : null
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
              t{sym} is a test token that tracks {market?.name ?? sym} on Arc Testnet. It trades against USDC in a hook pool whose fee follows the
              oracle reference price{market?.control ? ', and a control pool with a flat fee' : ''}. Everything on this page is read from the chain; nothing here is real
              money or real stock.
            </p>
            {market && (
              <div className="at-facts">
                <dl>
                  <div><dt>Underlying asset</dt><dd>{market.name}</dd></div>
                  <div><dt>Underlying ticker</dt><dd>{sym}</dd></div>
                  <div><dt>Category</dt><dd><span className="at-chip">Equities</span> <span className="at-chip">Test token</span></dd></div>
                  <div><dt>Base fee / cap</dt><dd>{market.hook.baseFeeBps} / {market.feeMaxBps} bps</dd></div>
                </dl>
                <dl>
                  <div><dt>Oracle reference</dt><dd>{usd(market.refPriceUsd, 2)}</dd></div>
                  <div><dt>Hook pool price</dt><dd>{usd(market.hook.priceUsd, 2)} ({bps(market.hook.devBps)} apart)</dd></div>
                  <div><dt>Hook fee buy / sell</dt><dd className={hi > market.hook.baseFeeBps + 0.01 ? 'surcharge' : undefined}>{market.hook.feeBuyBps.toFixed(0)} / {market.hook.feeSellBps.toFixed(0)} bps</dd></div>
                  <div><dt>Hook pool active liquidity</dt><dd>{usd(market.hook.tvlUsd)}</dd></div>
                  <div><dt>Oracle age</dt><dd className={market.stale ? 'surcharge' : undefined}>{market.refAgeSec}s (stale after {market.maxAgeSec}s){market.stale ? ' STALE' : ''}</dd></div>
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
                  {market?.control && <option value="control">Control pool (flat fee)</option>}
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
                <span className="sub">Balance: {!canTx ? 'connect a wallet' : side === 'buy' ? `${usd(state.wallet.usdc, 2)} USDC` : `${qty(have)} t${sym}`}</span>
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
                <span className="sub">{shown ? `${shown.exact ? 'Exact (on-chain dry run)' : 'Estimate'}. Minimum ${qty(shown.minOut, 6)} after slippage` : 'Enter an amount for a live quote'}</span>
              </div>
            </div>

            {canTx ? (
              <button type="submit" className="at-go" disabled={tx.busy || !shown || !(amt > 0) || insufficient}>
                {tx.busy ? 'Confirming...' : `${side === 'buy' ? 'Buy' : 'Sell'} t${sym}`}
              </button>
            ) : (
              <ActionGate />
            )}
            {insufficient && amt > 0 && (
              <p role="alert" className="err">
                {side === 'buy' ? (
                  <>Not enough USDC. Get test USDC from the <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle faucet</a>.</>
                ) : (
                  `You do not hold that much t${sym}. Mint some on the Mint & redeem page.`
                )}
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
              {shown.otherPoolOut !== null && cheaper !== null && (
                <p className="sub">
                  Same trade in the {shown.pool === 'hook' ? 'control' : 'hook'} pool (estimate): {qty(shown.otherPoolOut, 6)} {unitOut}. This pool gives you{' '}
                  {cheaper >= 0 ? 'more' : 'less'} by about {qty(Math.abs(cheaper), 6)} {unitOut}.
                </p>
              )}
            </div>
          )}
          <label className="at-slip">
            Slippage tolerance (%)
            <input type="number" min="0" step="0.1" inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} />
          </label>
          <TxStatus busy={tx.busy} step={tx.step} result={tx.result} unit={unitOut} verb="Trade confirmed" />
          {canTx && <p className="sub">The first swap of a token needs an approval transaction, then the swap. Both are signed in your wallet.</p>}
          <p className="at-legal">
            Test tokens on Arc Testnet only. Spot trading, no shorting. Nothing here is real money, real stock or investment advice.
          </p>
        </aside>
      </div>

      <h2>Your holdings</h2>
      <p className="sub">
        {canTx ? (
          <>USDC {usd(state.wallet.usdc, 2)}. Stock tokens valued at the oracle reference price: {usd(totalValue, 2)}.</>
        ) : (
          'Connect a wallet on Arc Testnet to see your balances.'
        )}
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th className="num">Quantity</th>
              <th className="num">Value at oracle price</th>
              <th>Contract</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.sym}>
                <td>t{h.sym}</td>
                <td className="num">{canTx ? qty(h.q) : '-'}</td>
                <td className="num">{canTx && h.q > 0 ? usd(h.value, 2) : '-'}</td>
                <td>{engine?.tokenAddress(h.sym) ? <a href={`${ARC_EXPLORER}/address/${engine.tokenAddress(h.sym)}`} target="_blank" rel="noreferrer"><code>{engine.tokenAddress(h.sym)?.slice(0, 10)}...</code></a> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
