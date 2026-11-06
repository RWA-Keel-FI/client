import type { PoolCfg, Reason } from './types.ts'

/**
 * Floating-point reference of the fee rule in ARCHITECTURE.md section 1.
 * The contract uses integer math (pips); this is only for the chart curve and the "why" text. Fees shown as charged always come from the hook (quoteFee / FeeSet).
 *
 *   d      = |pool / ref - 1|
 *   d_eff  = max(0, d - sigma * sqrt(age))
 *   fee    = max(f0, d_eff / 2) if the swap moves the pool toward ref, else f0   (clamped to fMax)
 */
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
