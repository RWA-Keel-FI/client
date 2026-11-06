import { curveFeeBps } from '../lib/fee.ts'
import type { PoolCfg, SwapRow } from '../lib/types.ts'

interface Props {
  rows: SwapRow[]
  cfg: PoolCfg
}

const W = 640
const H = 320
const PAD = { l: 52, r: 16, t: 16, b: 40 }

export function FeeChart({ rows, cfg }: Props) {
  const maxDev = Math.max(240, ...rows.map((r) => r.deviationBps))
  const xMax = Math.ceil(maxDev / 40) * 40
  const maxFee = Math.max(cfg.fMaxBps, ...rows.map((r) => r.chargedFeeBps))
  const yMax = Math.ceil((maxFee * 0.75) / 20) * 20 + 20
  const x = (d: number) => PAD.l + (d / xMax) * (W - PAD.l - PAD.r)
  const y = (f: number) => H - PAD.b - (f / yMax) * (H - PAD.t - PAD.b)

  const curve: string[] = []
  for (let d = 0; d <= xMax; d += 4) curve.push(`${x(d).toFixed(1)},${y(curveFeeBps(d, cfg)).toFixed(1)}`)

  const xTicks = Array.from({ length: xMax / 40 + 1 }, (_, i) => i * 40)
  const yTicks = Array.from({ length: Math.floor(yMax / 20) + 1 }, (_, i) => i * 20)
  const deadX = x(2 * cfg.f0Bps)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fee charged versus net deviation" className="chart">
      <title>Fee charged versus net deviation from the reference price</title>
      <rect x={PAD.l} y={PAD.t} width={Math.max(deadX - PAD.l, 0)} height={H - PAD.t - PAD.b} className="deadband" />
      {yTicks.map((f) => (
        <g key={`y${f}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(f)} y2={y(f)} className="grid" />
          <text x={PAD.l - 8} y={y(f) + 4} textAnchor="end" className="tick">
            {f}
          </text>
        </g>
      ))}
      {xTicks.map((d) => (
        <text key={`x${d}`} x={x(d)} y={H - PAD.b + 16} textAnchor="middle" className="tick">
          {d}
        </text>
      ))}
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" className="axis">
        net deviation d_eff (bps)
      </text>
      <text transform={`translate(14 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis">
        fee (bps)
      </text>
      <polyline points={curve.join(' ')} className="curve" fill="none" />
      <text x={deadX + 6} y={y(cfg.f0Bps) - 6} className="note">
        deadband: d_eff ≤ 2·f0
      </text>
      {rows.map((r) => (
        <circle
          key={r.id}
          cx={x(Math.min(r.deviationBps, xMax))}
          cy={y(Math.min(r.chargedFeeBps, yMax))}
          r={r.armed ? 4.5 : 2.5}
          className={r.armed ? 'pt armed' : 'pt'}
        >
          <title>{`${r.deviationBps.toFixed(0)} bps deviation, ${r.chargedFeeBps.toFixed(0)} bps fee`}</title>
        </circle>
      ))}
    </svg>
  )
}
