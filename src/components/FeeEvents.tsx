import { useMemo, useState } from 'react'
import { ARC_EXPLORER } from '../lib/chain/arc.ts'
import { useMarket } from '../lib/market/context.ts'
import { clock } from '../lib/market/format.ts'
import { FeeChart } from './FeeChart.tsx'
import type { SwapRow } from '../lib/types.ts'

/** FeeSet events emitted by the hook in beforeSwap: one per swap in a hook pool. Everything here is read from the chain. */
export function FeeEvents() {
  const { state } = useMarket()
  const [sym, setSym] = useState('all')
  const [armedOnly, setArmedOnly] = useState(false)

  const all = useMemo(() => state.feeEvents.filter((e) => sym === 'all' || e.sym === sym), [state.feeEvents, sym])
  const rows: SwapRow[] = useMemo(
    () =>
      all.map((e) => ({
        id: e.id,
        ts: e.ts,
        pool: e.sym,
        deviationBps: e.netDevBps,
        baseFeeBps: e.baseFeeBps,
        chargedFeeBps: e.feeBps,
        armed: e.armed,
        reason: e.armed ? 'surcharge' : 'inside-deadband',
      })),
    [all],
  )
  const market = state.markets.find((m) => m.sym === sym) ?? state.markets[0]
  const cfg = { f0Bps: market?.hook.baseFeeBps ?? 30, fMaxBps: market?.feeMaxBps ?? 200, sigmaBpsPerRootSec: 0, staleAfterSec: market?.maxAgeSec ?? 900 }
  const armed = all.filter((e) => e.armed).length
  const shown = (armedOnly ? all.filter((e) => e.armed) : all).slice().reverse().slice(0, 100)

  return (
    <section aria-label="Fee events">
      <p className="sub">
        Every swap in a hook pool emits <code>FeeSet(poolId, fee, f0, deviationBps, armed)</code> from <code>DeviationFeeHook.beforeSwap</code>. {all.length} events
        loaded from the recent blocks, {armed} surcharged ({all.length ? ((armed / all.length) * 100).toFixed(1) : '0.0'}%). Deviation is net of reference noise and is 0 for
        swaps that move the pool away from the reference. The event carries no swap size or direction.
      </p>
      <div className="controls">
        <label className="inline">
          Stock
          <select value={sym} onChange={(e) => setSym(e.target.value)}>
            <option value="all">all</option>
            {state.markets.map((m) => (
              <option key={m.sym} value={m.sym}>{m.sym}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={armedOnly} onChange={(e) => setArmedOnly(e.target.checked)} />
          surcharged only
        </label>
      </div>
      {all.length === 0 ? (
        <p className="sub">No FeeSet events in the loaded block window yet. They appear as soon as someone swaps in a hook pool.</p>
      ) : (
        <FeeChart rows={rows} cfg={cfg} />
      )}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>Stock</th>
              <th className="num">Net deviation (bps)</th>
              <th className="num">Base fee (bps)</th>
              <th className="num">Charged (bps)</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6}>No events.</td>
              </tr>
            )}
            {shown.map((e) => (
              <tr key={e.id} className={e.armed ? 'armedrow' : undefined}>
                <td>{e.ts ? clock(e.ts) : 'n/a'}</td>
                <td>t{e.sym}</td>
                <td className="num">{e.netDevBps}</td>
                <td className="num">{e.baseFeeBps.toFixed(1)}</td>
                <td className="num">{e.feeBps.toFixed(1)}{e.armed ? ' (surcharge)' : ''}</td>
                <td><a href={`${ARC_EXPLORER}/tx/${e.tx}`} target="_blank" rel="noreferrer"><code>{e.tx.slice(0, 10)}...</code></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
