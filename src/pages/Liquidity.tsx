import { useState } from 'react'
import { TxStatus, useTx } from '../components/Tx.tsx'
import { ActionGate, useCanTransact } from '../components/WalletButton.tsx'
import { useMarket } from '../lib/market/context.ts'
import { qty, usd } from '../lib/market/format.ts'
import type { PoolKind, RangePreset } from '../lib/market/types.ts'

const RANGES: { id: RangePreset; label: string; text: string }[] = [
  { id: 'wide', label: 'Wide', text: 'about +/-40% around the price: low fees per dollar, rarely out of range' },
  { id: 'medium', label: 'Medium', text: 'about +/-12%: more fees per dollar, out of range on a big move' },
  { id: 'tight', label: 'Tight', text: 'about +/-3%: most fees per dollar, out of range after a small move' },
]

export function Liquidity({ sym, onSym }: { sym: string; onSym: (s: string) => void }) {
  const { engine, state } = useMarket()
  const [pool, setPool] = useState<PoolKind>('hook')
  const [range, setRange] = useState<RangePreset>('medium')
  const [amount, setAmount] = useState('100')
  const addTx = useTx()
  const rmTx = useTx()
  const canTx = useCanTransact()
  const amt = Number(amount)
  const market = state.markets.find((m) => m.sym === sym)
  const have = state.wallet.tokens[sym] ?? 0
  const price = market ? (pool === 'control' && market.control ? market.control.priceUsd : market.hook.priceUsd) : 0
  const needStock = price > 0 ? amt / 2 / price : 0
  const short = canTx && (amt / 2 > state.wallet.usdc || needStock > have)

  return (
    <section aria-label="Liquidity">
      <p className="caveat">
        Add and remove call LiquidityRouter.addLiquidityAmounts and removeLiquidity, signed by your wallet. A deposit takes half its value in USDC and half in the
        stock token at the pool price, so you need both (mint the token on the Mint &amp; redeem page). Positions are found from your LiquidityChanged events and read
        live from the pool. Fees earned are not read back from the chain, so they are not shown; the value below is principal at the current price.
      </p>
      <div className="twocol">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void addTx.run((onStep) => engine!.addLiquidity(sym, pool, amt, range, onStep))
          }}
        >
          <h2>Add liquidity</h2>
          <label className="field">
            Stock
            <select value={sym} onChange={(e) => onSym(e.target.value)}>
              {(engine?.syms ?? []).map((s) => (
                <option key={s} value={s}>
                  t{s} / USDC
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
              {market?.control && (
                <button type="button" aria-pressed={pool === 'control'} onClick={() => setPool('control')}>
                  Control pool
                </button>
              )}
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
            Deposit (USDC value)
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="sub">
              Needs {usd(amt / 2 || 0, 2)} USDC and about {qty(needStock, 6)} t{sym}.{canTx ? ` You have ${usd(state.wallet.usdc, 2)} USDC and ${qty(have)} t${sym}.` : ''}
            </span>
          </label>
          {canTx ? (
            <button type="submit" className="primary" disabled={!(amt > 0) || short || addTx.busy}>
              {addTx.busy ? 'Confirming...' : 'Add liquidity'}
            </button>
          ) : (
            <ActionGate />
          )}
          {short && amt > 0 && <p role="alert" className="err">Not enough balance for both halves of the deposit.</p>}
          <TxStatus busy={addTx.busy} step={addTx.step} result={addTx.result} verb="Position opened" />
        </form>

        <div className="panel">
          <h2>How to read this</h2>
          <ul className="plain">
            <li><strong>Range</strong> is where your liquidity earns fees. Outside it you hold one token and earn nothing.</li>
            <li><strong>Tighter range</strong> earns more fees per dollar but goes out of range sooner.</li>
            <li><strong>Hook vs control:</strong> the hook pool charges arbitrageurs more, so LPs lose less to them. The control pool has a flat fee and no hook.</li>
            <li>Each add needs approvals for both tokens, then the deposit. All are signed in your wallet.</li>
          </ul>
        </div>
      </div>

      <h2>Your positions</h2>
      {!canTx ? (
        <p className="sub">Connect a wallet on Arc Testnet to see your positions.</p>
      ) : state.positions.length === 0 ? (
        <p className="sub">No open positions found for this wallet.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Pool</th>
                <th>Price range (USD)</th>
                <th className="num">Liquidity</th>
                <th className="num">Stock</th>
                <th className="num">USDC</th>
                <th className="num">Value</th>
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
                    {usd(p.lowerUsd, 2)} to {usd(p.upperUsd, 2)}
                    {p.inRange ? '' : ' (out of range, no fees)'}
                  </td>
                  <td className="num">{p.liquidity}</td>
                  <td className="num">{qty(p.stock, 6)}</td>
                  <td className="num">{usd(p.usdc, 2)}</td>
                  <td className="num">{usd(p.valueUsd, 2)}</td>
                  <td>
                    <button type="button" disabled={rmTx.busy} onClick={() => void rmTx.run((onStep) => engine!.removeLiquidity(p.id, onStep))}>
                      Remove all
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TxStatus busy={rmTx.busy} step={rmTx.step} result={rmTx.result} verb="Position removed" />

      <h2>Pools</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th>Pool</th>
              <th className="num">Price</th>
              <th className="num">Deviation</th>
              <th className="num">Fee buy / sell (bps)</th>
              <th className="num">Active liquidity</th>
              <th className="num">Volume (loaded window)</th>
            </tr>
          </thead>
          <tbody>
            {state.markets.flatMap((m) =>
              ([['hook', m.hook], ['control', m.control]] as const).map(([k, v]) =>
                v ? (
                  <tr key={m.sym + k}>
                    <td>t{m.sym}</td>
                    <td>{k}</td>
                    <td className="num">{usd(v.priceUsd, 2)}</td>
                    <td className="num">{v.devBps.toFixed(1)} bps</td>
                    <td className="num">{v.feeBuyBps.toFixed(1)} / {v.feeSellBps.toFixed(1)}</td>
                    <td className="num">{usd(v.tvlUsd)}</td>
                    <td className="num">{usd(v.volumeUsd)}</td>
                  </tr>
                ) : null,
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
