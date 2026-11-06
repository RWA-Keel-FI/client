import { useState } from 'react'
import { explain } from '../lib/fee.ts'
import type { SwapRow } from '../lib/types.ts'

function usd(n: number | undefined): string {
  return n === undefined ? 'n/a' : '$' + Math.round(n).toLocaleString('en-US')
}

export function SwapTable({ rows }: { rows: SwapRow[] }) {
  const [onlyArmed, setOnlyArmed] = useState(false)
  const shown = (onlyArmed ? rows.filter((r) => r.armed) : rows).slice().reverse().slice(0, 100)
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={onlyArmed} onChange={(e) => setOnlyArmed(e.target.checked)} />
        show only surcharged swaps
      </label>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th className="num">Size</th>
              <th>Direction</th>
              <th className="num">Net dev (bps)</th>
              <th className="num">Base fee (bps)</th>
              <th className="num">Charged (bps)</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7}>No swaps yet.</td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className={r.armed ? 'armedrow' : undefined}>
                <td>{r.ts ? new Date(r.ts * 1000).toISOString().slice(11, 19) : 'n/a'}</td>
                <td className="num">{usd(r.sizeUsd)}</td>
                <td>{r.towardRef === undefined ? 'n/a' : r.towardRef ? 'toward ref' : 'away from ref'}</td>
                <td className="num">{r.deviationBps.toFixed(0)}</td>
                <td className="num">{r.baseFeeBps.toFixed(0)}</td>
                <td className="num">{r.chargedFeeBps.toFixed(0)}</td>
                <td className="why">{explain(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
