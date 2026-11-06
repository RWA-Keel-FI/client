import type { CSSProperties } from 'react'

export interface Headline {
  upliftPct: number
  swaps: number
  volume: number
  surchargedPct: number
  nonArb: number
  volSurchargedPct: number
  smallSurchargedPct: number
}

// Fallback = pooled_core_baseline from server/backtest/results.json at time of writing.
export const FALLBACK: Headline = { upliftPct: 5.5, swaps: 22858, volume: 8706504, surchargedPct: 1.6, nonArb: 0, volSurchargedPct: 5.45, smallSurchargedPct: 1.3 }

export function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n / 1e3)}K`
}


/** Sets the --i stagger index used by the reveal CSS. */
export const idx = (i: number) => ({ '--i': i }) as CSSProperties
