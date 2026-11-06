import { LOWER_CONFIDENCE, POOL_LABELS, signedPct, signedUsd, stressRows, usd } from '../lib/backtest.ts'
import type { BacktestFile, Stats } from '../lib/backtest.ts'

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  )
}

function StatsCells({ s }: { s: Stats }) {
  return (
    <>
      <td className="num">{signedUsd(s.delta_pnl)}</td>
      <td className="num">{signedPct(s.delta_pct)}</td>
      <td className="num">{s.pct_swaps_surcharged.toFixed(1)}%</td>
      <td className="num">{s.pct_small_swaps_surcharged.toFixed(1)}%</td>
      <td className="num">{s.fair_price_violations}</td>
    </>
  )
}

export function BacktestPanel({ results }: { results: BacktestFile | null }) {
  if (!results) {
    return (
      <p>
        No usable <code>results.json</code> in <code>/public</code>. Run the backtest, then <code>pnpm sync-results</code>.
      </p>
    )
  }

  const h = results.pooled_core_baseline
  const m = results.meta
  const windowStart = m.window_5m[0].slice(0, 10)
  const poolEntries = Object.entries(results.pools)

  return (
    <div>
      <p className="caveat">
        Replay of real Ondo-token swaps on Ethereum since {windowStart}, with trading volume held constant. The reference
        price is a 5-minute stock bar standing in for the oracle, and arbitrageurs would adapt in practice. Read the gain
        as small: this is a safety rule, not a profit engine.
      </p>

      <h2>Headline: three core pools</h2>
      <div className="tiles">
        <Tile
          label="LP P&L change"
          value={signedUsd(h.delta_pnl)}
          sub={`${signedPct(h.delta_pct)} on ${usd(h.volume)} of volume`}
        />
        <Tile
          label="Swaps surcharged"
          value={`${h.pct_swaps_surcharged.toFixed(1)}%`}
          sub={`${h.n_small_sur} of ${h.n_small.toLocaleString('en-US')} swaps under ${usd(m.SMALL_USD)}`}
        />
        <Tile
          label="Normal users hurt"
          value={`${h.nonarb_swaps_surcharged} / ${h.fair_price_violations}`}
          sub="non-arbitrage swaps surcharged / swaps priced worse than the reference"
        />
        <Tile
          label="Concentration"
          value={`${h.top10_share_of_extra_fee_pct.toFixed(0)}%`}
          sub="of the extra fees come from the 10 largest swaps"
        />
      </div>

      <h2>Per pool</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Pool</th>
              <th className="num">Volume</th>
              <th className="num">LP P&amp;L before</th>
              <th className="num">LP P&amp;L after</th>
              <th className="num">Change</th>
              <th className="num">Swaps surcharged</th>
              <th className="num">Small swaps surcharged</th>
            </tr>
          </thead>
          <tbody>
            {poolEntries.map(([key, p]) => {
              const b = p.baseline
              const weak = LOWER_CONFIDENCE.has(key)
              return (
                <tr key={key}>
                  <td>
                    {POOL_LABELS[key] ?? key}
                    {weak ? <span className="sub"> lower confidence (see note)</span> : null}
                  </td>
                  <td className="num">{usd(b.volume)}</td>
                  <td className="num">{usd(b.base_pnl)}</td>
                  <td className="num">{usd(b.new_pnl)}</td>
                  <td className="num">
                    {signedUsd(b.delta_pnl)} ({signedPct(b.delta_pct)})
                  </td>
                  <td className="num">{b.pct_swaps_surcharged.toFixed(1)}%</td>
                  <td className="num">{b.pct_small_swaps_surcharged.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {poolEntries.some(([k]) => LOWER_CONFIDENCE.has(k)) ? (
        <p className="sub">
          Note: SPYon trades about 91 bps above SPY for an unknown reason (dividends and share multipliers do not explain
          it), so a basis correction is applied and the pool is left out of the headline.
        </p>
      ) : null}

      <h2>Stress tests (three core pools)</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th className="num">LP P&amp;L change</th>
              <th className="num">%</th>
              <th className="num">Swaps hit</th>
              <th className="num">Small swaps hit</th>
              <th className="num">Worse than ref.</th>
            </tr>
          </thead>
          <tbody>
            {stressRows(results).map((r) => (
              <tr key={r.label}>
                <td className="why">
                  {r.label}
                  {r.note ? <span className="sub"> {r.note}</span> : null}
                </td>
                {r.stats ? (
                  <StatsCells s={r.stats} />
                ) : (
                  <td className="num" colSpan={5}>
                    not in results.json
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="caveat">
        Volatility used for the noise allowance (bps per root second):{' '}
        {Object.entries(m.sigma_bps_per_sqrt_s)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`)
          .join(', ')}
        . Fees are capped at {(m.F_MAX * 100).toFixed(0)}% and a reference older than {Math.round(m.STALE_S / 60)} minutes
        falls back to the base fee. Generated {m.generated.slice(0, 10)}.
      </p>
    </div>
  )
}
