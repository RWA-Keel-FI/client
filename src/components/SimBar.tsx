import { useState } from 'react'
import { useMarket } from '../lib/market/context.ts'
import { clock } from '../lib/market/format.ts'

/** Source switch plus the simulation controls (mock only). */
export function SimBar({ hideBanner = false }: { hideBanner?: boolean }) {
  const { engine, state, source, setSource, loadError } = useMarket()
  const [shockSym, setShockSym] = useState('NVDA')
  const mock = source === 'mock'
  return (
    <div>
      {!hideBanner && (
        <div className={mock ? 'banner mock' : 'banner'}>
          {state.sourceNote}
        </div>
      )}
      {loadError && (
        <p role="alert" className="err">
          Could not start the anvil engine: {loadError} Showing the mock engine instead.
        </p>
      )}
      {state.error && (
        <p role="alert" className="err">
          Chain read failed: {state.error}
        </p>
      )}
      <div className="bar simbar">
        <div className="controls" role="group" aria-label="Data source">
          <button type="button" aria-pressed={mock} onClick={() => setSource('mock')}>
            Mock (browser)
          </button>
          <button type="button" aria-pressed={!mock} onClick={() => setSource('chain')}>
            Anvil (local chain)
          </button>
        </div>
        {mock && engine && (
          <div className="controls" role="group" aria-label="Simulation controls">
            <button type="button" onClick={() => engine.setPlaying(!state.sim.playing)}>
              {state.sim.playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" aria-pressed={state.sim.speed === 1} onClick={() => engine.setSpeed(1)}>
              1x
            </button>
            <button type="button" aria-pressed={state.sim.speed === 3} onClick={() => engine.setSpeed(3)}>
              3x
            </button>
            <label className="inline">
              News on
              <select value={shockSym} onChange={(e) => setShockSym(e.target.value)} aria-label="Ticker for the news shock">
                {engine.syms.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => engine.newsShock(shockSym, -0.015)}>
              -1.5%
            </button>
            <button type="button" onClick={() => engine.newsShock(shockSym, 0.015)}>
              +1.5%
            </button>
            <button type="button" aria-pressed={state.markets[0]?.sessionOpen ?? true} onClick={() => engine.setSession(true)}>
              Session open
            </button>
            <button type="button" aria-pressed={!(state.markets[0]?.sessionOpen ?? true)} onClick={() => engine.setSession(false)}>
              Session closed
            </button>
            <span className="sub">sim clock {clock(state.sim.simTs)} UTC</span>
          </div>
        )}
      </div>
    </div>
  )
}
