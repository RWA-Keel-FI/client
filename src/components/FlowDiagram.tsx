import type { FlowEvent } from '../lib/market/types.ts'
import { BRAND } from '../brand.ts'

function Box({ x, y, w, h, title, lines }: { x: number; y: number; w: number; h: number; title: string; lines: string[] }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} className="fd-box" />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" className="fd-title">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l + i} x={x + w / 2} y={y + 42 + i * 16} textAnchor="middle" className="fd-line">
          {l}
        </text>
      ))}
    </g>
  )
}

function Arrow({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label?: string }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="fd-arrow" markerEnd="url(#fd-head)" />
      {label && (
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="fd-label">
          {label}
        </text>
      )}
    </g>
  )
}

/** Oracle -> hook -> pool -> LPs, with retail, arbitrageur and the issuer feeding in. Counters come from the event stream. */
export function FlowDiagram({ events }: { events: FlowEvent[] }) {
  const oracle = events.filter((e) => e.kind === 'oracle' && e.actor === 'oracle').length
  const swaps = events.filter((e) => e.kind === 'swap' && e.pool === 'hook')
  const armed = swaps.filter((e) => e.armed).length
  const you = swaps.filter((e) => e.actor === 'you').length
  const others = swaps.length - you
  const mints = events.filter((e) => e.kind === 'mint' || e.kind === 'redeem').length
  return (
    <svg viewBox="0 0 920 300" className="flowdiagram" role="img" aria-label="Flow diagram: oracle feeds the hook, the hook sets the pool fee, swaps pay fees to liquidity providers">
      <defs>
        <marker id="fd-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fd-headpath" />
        </marker>
      </defs>
      <Box x={10} y={20} w={170} h={86} title="Price oracle" lines={['Chainlink CRE report', `${oracle} updates seen`, 'price + session flag']} />
      <Box x={250} y={20} w={190} h={86} title={`${BRAND} hook`} lines={['beforeSwap sets the fee', `${armed} of ${swaps.length} swaps surcharged`, 'fail-open when stale/closed']} />
      <Box x={510} y={20} w={170} h={86} title="Pool (tStock/USDC)" lines={['swap executes', `${you} yours, ${others} others`, 'fee stays in the pool']} />
      <Box x={750} y={20} w={160} h={86} title="Liquidity providers" lines={['earn the fee', 'fee accrues to positions', 'lose to arb at base fee']} />
      <Arrow x1={180} y1={63} x2={250} y2={63} label="price" />
      <Arrow x1={440} y1={63} x2={510} y2={63} label="fee" />
      <Arrow x1={680} y1={63} x2={750} y2={63} label="fees" />

      <Box x={250} y={170} w={190} h={70} title="Arbitrageur" lines={['trades toward the real price', 'pays the surcharge']} />
      <Box x={510} y={170} w={170} h={70} title="Everyone else" lines={['pays the base fee', 'away-from-reference swaps']} />
      <Arrow x1={345} y1={170} x2={560} y2={106} />
      <Arrow x1={595} y1={170} x2={595} y2={106} />
      <Box x={10} y={170} w={200} h={70} title="Issuer (primary market)" lines={[`${mints} mints/redeems`, 'only while session is open']} />
      <text x={10} y={275} className="fd-line">
        Closed session: no reference, the hook charges the base fee, the issuer pauses, pools keep trading.
      </text>
    </svg>
  )
}
