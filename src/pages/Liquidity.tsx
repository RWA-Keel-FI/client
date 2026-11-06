import { useState } from 'react'
import { useMarket } from '../lib/market/context.ts'
import { qty, shortHash, signedUsd, usd } from '../lib/market/format.ts'
import type { PoolKind, PoolStats, RangePreset, TradeResult } from '../lib/market/types.ts'

const RANGES: { id: RangePreset; label: string; text: string }[] = [
  { id: 'wide', label: 'Wide', text: 'about +/-40% around the price: low fees per dollar, rarely out of range' },
  { id: 'medium', label: 'Medium', text: 'about +/-12%: more fees per dollar, out of range on a big move' },
  { id: 'tight', label: 'Tight', text: 'about +/-3%: most fees per dollar, out of range after a small move' },
]

function sum(list: PoolStats[], f: (s: PoolStats) => number): number {
  return list.reduce((a, s) => a + f(s), 0)
}

export function Liquidity({ sym, onSym }: { sym: string; onSym: (s: string) => void }) {
  const { engine, state } = useMarket()
  const [pool, setPool] = useState<PoolKind>('hook')
  const [range, setRange] = useState<RangePreset>('medium')
  const [amount, setAmount] = useState('5000')
  const [res, setRes] = useState<TradeResult | null>(null)
  const amt = Number(amount)
  const summary = state.summary
  const entries = summary ? Object.entries(summary.tickers) : []
  const hooks = entries.map(([, v]) => v.hook)
  const controls = entries.map(([, v]) => v.control)
  const mock = state.mode === 'mock'

  return (
    <section aria-label="Liquidity">
      <p className="caveat">
        {mock
          ? 'Mock accounting: positions use a simplified concentration model (fee share and impermanent loss scaled by range), not Uniswap v4 tick math. Use it to see the shape of the trade-off.'
          : 'Anvil: add and remove call LiquidityRouter.addLiquidityAmounts and removeLiquidity. Value is computed from the position’s liquidity and the current price. Fees earned are not read back from the chain, so Fees and vs holding show 0. You need both tUSDC and the stock token for a deposit.'}
      </p>
      <div className="twocol">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void engine?.addLiquidity(sym, pool, amt, range).then(setRes)
          }}
        >
          <h2>Add liquidity</h2>
          <label className="field">
            Stock
            <select value={sym} onChange={(e) => onSym(e.target.value)}>
              {(engine?.syms ?? []).map((s) => (
                <option key={s} value={s}>
                  t{s} / tUSDC
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span id="lp-pool">Pool</span>
            <div className="controls" role="group" aria-labelledby="lp-pool">
              <button type="button" aria-pressed={pool === 'hook'} onClick={() => setPool('hook')}>
                Hook pool
              </button>
              <button type="button" aria-pressed={pool === 'control'} onClick={() => setPool('control')}>
                Control pool
              </button>
            </div>
          </div>
          <fieldset className="field">
            <legend>Range</legend>
            {RANGES.map((r) => (
              <label key={r.id} className="radio">
                <input type="radio" name="range" checked={range === r.id} onChange={() => setRange(r.id)} />
                <span>
                  <strong>{r.label}</strong> <span className="sub">{r.text}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            Deposit (tUSDC value)
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="sub">Balance {usd(state.wallet.usdc, 2)} tUSDC</span>
          </label>
          <button type="submit" className="primary" disabled={!(amt > 0) || amt > state.wallet.usdc}>
            Add liquidity
          </button>
          {res && (
            <div role="status" className={res.ok ? 'result ok' : 'result bad'}>
              {res.ok ? (
                <>
                  Position opened. Tx <code>{shortHash(res.hash ?? '')}</code>
                  {mock ? ' (mock)' : ''}
                </>
              ) : (
                <>Not added: {res.error}</>
              )}
            </div>
          )}
        </form>

        <div className="panel">
          <h2>How to read this</h2>
          <ul className="plain">
            <li><strong>Fees</strong> are your share of the swap fees while the price stays inside your range.</li>
            <li><strong>vs holding</strong> is your value minus what the same deposit would be worth just held. Negative means impermanent loss beat the fees.</li>
            <li><strong>Tighter range</strong> earns more fees per dollar but goes out of range sooner and then earns nothing.</li>
            <li><strong>Hook vs control:</strong> the hook pool charges arbitrageurs more, so LPs lose less to them. Compare the two pools below.</li>
          </ul>
        </div>
      </div>

      <h2>Your positions</h2>
      {state.positions.length === 0 ? (
        <p className="sub">No positions yet. Add some liquidity and let the simulation run.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Pool</th>
                <th>Range</th>
                <th className="num">Deposit</th>
                <th className="num">Fees</th>
                <th className="num">Value</th>
                <th className="num">vs holding</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.positions.map((p) => (
                <tr key={p.id}>
                  <td>
                    t{p.sym} {p.pool}
                  </td>
                  <td>
                    {p.range}
                    {p.inRange ? '' : ' (out of range, no fees)'}
                  </td>
                  <td className="num">{usd(p.depositUsd, 2)}</td>
                  <td className="num">{usd(p.feesUsd, 2)}</td>
                  <td className="num">{usd(p.valueUsd, 2)}</td>
                  <td className="num">{signedUsd(p.vsHoldUsd)}</td>
                  <td>
                    <button type="button" onClick={() => void engine?.removeLiquidity(p.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Hook pool vs control pool</h2>
      <p className="sub">
        Same retail orders hit both pools. LP P&amp;L here is fees minus what arbitrageurs extract, measured against the true
        price ({summary?.source === 'file' ? 'from the sim summary file' : 'simulated in this page, resets on reload'}). Surcharge
        rates here depend on the shocks you inject and are not the backtest result (see the Backtest tab).
      </p>
      {summary ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Stock</th>
                <th>Pool</th>
                <th className="num">Volume</th>
                <th className="num">Fees</th>
                <th className="num">Arb profit</th>
                <th className="num">Retail fees paid</th>
                <th className="num">LP P&amp;L</th>
                <th className="num">Swaps surcharged</th>
                <th className="num">Retail surcharged</th>
              </tr>
            </thead>
            <tbody>
              {entries.flatMap(([s, v]) =>
                (['hook', 'control'] as const).map((k) => {
                  const p = v[k]
                  return (
                    <tr key={s + k}>
                      <td>t{s}</td>
                      <td>{k}</td>
                      <td className="num">{usd(p.volumeUsd)}</td>
                      <td className="num">{usd(p.feesUsd)}</td>
                      <td className="num">{usd(p.arbProfitUsd)}</td>
                      <td className="num">{usd(p.retailFeePaidUsd)}</td>
                      <td className="num">{signedUsd(p.lpPnlUsd, 0)}</td>
                      <td className="num">{p.swapsSurchargedPct.toFixed(1)}%</td>
                      <td className="num">{p.retailSurchargedPct.toFixed(1)}%</td>
                    </tr>
                  )
                }),
              )}
              <tr className="totalrow">
                <td>All</td>
                <td>hook</td>
                <td className="num">{usd(sum(hooks, (s) => s.volumeUsd))}</td>
                <td className="num">{usd(sum(hooks, (s) => s.feesUsd))}</td>
                <td className="num">{usd(sum(hooks, (s) => s.arbProfitUsd))}</td>
                <td className="num">{usd(sum(hooks, (s) => s.retailFeePaidUsd))}</td>
                <td className="num">{signedUsd(sum(hooks, (s) => s.lpPnlUsd), 0)}</td>
                <td className="num" colSpan={2} />
              </tr>
              <tr className="totalrow">
                <td>All</td>
                <td>control</td>
                <td className="num">{usd(sum(controls, (s) => s.volumeUsd))}</td>
                <td className="num">{usd(sum(controls, (s) => s.feesUsd))}</td>
                <td className="num">{usd(sum(controls, (s) => s.arbProfitUsd))}</td>
                <td className="num">{usd(sum(controls, (s) => s.retailFeePaidUsd))}</td>
                <td className="num">{signedUsd(sum(controls, (s) => s.lpPnlUsd), 0)}</td>
                <td className="num" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sub">
          No summary available. In anvil mode run the simulation (it writes sim/out/summary.json) and run{' '}
          <code>pnpm sync-deployments</code>.
        </p>
      )}
      <p className="sub">{qty(state.positions.length, 0)} open position(s).</p>
    </section>
  )
}
