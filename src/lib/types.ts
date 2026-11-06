export type Reason =
  | 'no-reference'
  | 'session-closed'
  | 'stale-reference'
  | 'non-arbitrage-direction'
  | 'inside-deadband'
  | 'surcharge'

/** Pool config mirrored from ARCHITECTURE.md 4.3. Fees in bps in the UI (1 bp = 100 pips). */
export interface PoolCfg {
  f0Bps: number
  fMaxBps: number
  /** volatility, bps per root second */
  sigmaBpsPerRootSec: number
  staleAfterSec: number
}

export interface SwapRow {
  id: string
  /** unix seconds */
  ts: number
  pool: string
  /** swap size in USD, undefined when the source does not provide it */
  sizeUsd?: number
  /** true when the swap moves the pool toward the reference; undefined when unknown */
  towardRef?: boolean
  /** noise-adjusted deviation d_eff, bps (the FeeSet.deviationBps field) */
  deviationBps: number
  baseFeeBps: number
  chargedFeeBps: number
  armed: boolean
  reason: Reason
}
