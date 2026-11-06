import type { PoolCfg, Reason } from './types.ts'

/**
 * Floating-point reference of the fee rule in ARCHITECTURE.md section 1.
 * The contract uses integer math (pips); this is for charts, the "why" text and the mock replay.
 *
 *   d      = |pool / ref - 1|
 *   d_eff  = max(0, d - sigma * sqrt(age))
 *   fee    = max(f0, d_eff / 2) if the swap moves the pool toward ref, else f0   (clamped to fMax)
 */
export const DEFAULT_CFG: PoolCfg = {
  f0Bps: 30,
  fMaxBps: 200,
  sigmaBpsPerRootSec: 0.85,
  staleAfterSec: 900,
}

export interface FeeInput {
  poolPrice: number
  refPrice: number
  ageSec: number
  towardRef: boolean
  sessionOpen: boolean
  cfg: PoolCfg
}

export interface FeeOutput {
  dBps: number
  dEffBps: number
  feeBps: number
  armed: boolean
  reason: Reason
}

export function computeFee(i: FeeInput): FeeOutput {
  const { cfg } = i
  const base = { dBps: 0, dEffBps: 0, feeBps: cfg.f0Bps, armed: false }
  if (!(i.refPrice > 0)) return { ...base, reason: 'no-reference' }
  const dBps = Math.abs(i.poolPrice / i.refPrice - 1) * 1e4
  const noise = cfg.sigmaBpsPerRootSec * Math.sqrt(Math.max(i.ageSec, 0))
  const dEffBps = Math.max(0, dBps - noise)
  const out = { dBps, dEffBps, feeBps: cfg.f0Bps, armed: false }
  if (!i.sessionOpen) return { ...out, reason: 'session-closed' }
  if (i.ageSec > cfg.staleAfterSec) return { ...out, reason: 'stale-reference' }
  if (!i.towardRef) return { ...out, reason: 'non-arbitrage-direction' }
  if (dEffBps / 2 <= cfg.f0Bps) return { ...out, reason: 'inside-deadband' }
  return { ...out, feeBps: Math.min(cfg.fMaxBps, dEffBps / 2), armed: true, reason: 'surcharge' }
}

/** Theoretical fee curve for an arbitrage-direction swap, as a function of d_eff. */
export function curveFeeBps(dEffBps: number, cfg: PoolCfg): number {
  return Math.min(cfg.fMaxBps, Math.max(cfg.f0Bps, dEffBps / 2))
}

export const REASON_TEXT: Record<Reason, string> = {
  'no-reference': 'No reference price for this pool, so the base fee applies.',
  'session-closed': 'US session closed, so there is no live reference and the base fee applies.',
  'stale-reference': 'Reference price is stale, so the hook fails open to the base fee.',
  'non-arbitrage-direction': 'Swap moves the pool away from the reference, so it pays the base fee.',
  'inside-deadband': 'Pool is within twice the base fee of the reference (net of noise), so the base fee applies.',
  surcharge: 'Arbitrage-direction swap, pool mispriced beyond the deadband: fee is half the net deviation.',
}

export function explain(row: {
  reason: Reason
  deviationBps: number
  baseFeeBps: number
  chargedFeeBps: number
}): string {
  if (row.reason === 'surcharge') {
    return `Pool ${row.deviationBps.toFixed(0)} bps off the reference (net of noise); arbitrage direction, so fee = deviation / 2 = ${row.chargedFeeBps.toFixed(0)} bps instead of ${row.baseFeeBps.toFixed(0)}.`
  }
  return REASON_TEXT[row.reason]
}
