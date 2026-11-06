import { useState } from 'react'
import { FlowDiagram } from '../components/FlowDiagram.tsx'
import { useMarket } from '../lib/market/context.ts'
import { clock, usd } from '../lib/market/format.ts'
import type { Actor, FlowEvent } from '../lib/market/types.ts'

const KINDS: FlowEvent['kind'][] = ['oracle', 'session', 'swap', 'mint', 'redeem', 'lp', 'faucet']
const ACTORS: Actor[] = ['retail', 'arb', 'you', 'issuer', 'oracle', 'system']

export function Flows() {
  const { engine, state } = useMarket()
  const [kinds, setKinds] = useState<Set<FlowEvent['kind']>>(new Set(['swap', 'session', 'mint', 'redeem', 'lp', 'faucet', 'oracle']))
  const [actor, setActor] = useState<'all' | Actor>('all')
  const [sym, setSym] = useState('all')
  const [armedOnly, setArmedOnly] = useState(false)

  const toggle = (k: FlowEvent['kind']) =>
    setKinds((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const shown = state.events
    .filter((e) => kinds.has(e.kind) && (actor === 'all' || e.actor === actor) && (sym === 'all' || e.sym === sym) && (!armedOnly || e.armed))
    .slice()
    .reverse()
    .slice(0, 120)

  return (
    <section aria-label="Flows">
      <FlowDiagram events={state.events} summary={state.summary} />
      <fieldset className="filters">
        <legend>Filters</legend>
        {KINDS.map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} />
            {k}
          </label>
        ))}
        <label className="inline">
          Actor
          <select value={actor} onChange={(e) => setActor(e.target.value as 'all' | Actor)}>
            <option value="all">all</option>
            {ACTORS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="inline">
          Stock
          <select value={sym} onChange={(e) => setSym(e.target.value)}>
            <option value="all">all</option>
            {(engine?.syms ?? []).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={armedOnly} onChange={(e) => setArmedOnly(e.target.checked)} />
          surcharged swaps only
        </label>
      </fieldset>
      <p className="sub">
        {shown.length} events shown of {state.events.length}. Swap events show who traded when the source knows it
        {state.mode === 'chain' ? ' (on anvil the actor comes from the swap router’s payer address, matched to the deployment’s arb, retail and LP accounts)' : ''}.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>Event</th>
              <th>Stock</th>
              <th>Pool</th>
              <th>Actor</th>
              <th className="num">Size</th>
              <th className="num">Fee (bps)</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className={e.armed ? 'armedrow' : undefined}>
                <td>{clock(e.ts)}</td>
                <td>{e.kind}</td>
                <td>{e.sym ?? '-'}</td>
                <td>{e.pool ?? '-'}</td>
                <td>{e.actor}</td>
                <td className="num">{e.sizeUsd !== undefined ? usd(e.sizeUsd) : '-'}</td>
                <td className="num">
                  {e.feeBps !== undefined ? e.feeBps.toFixed(1) : '-'}
                  {e.armed ? ' (surcharge)' : ''}
                </td>
                <td className="why">{e.detail}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8}>No events yet. Press Play, or trade.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
