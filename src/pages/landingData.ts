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

// Headline numbers come only from server/backtest/results.json (public/results.json). There is no hardcoded fallback: until the file loads,
// the landing shows dashes.

export function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n / 1e3)}K`
}


/** Sets the --i stagger index used by the reveal CSS. */
export const idx = (i: number) => ({ '--i': i }) as CSSProperties
