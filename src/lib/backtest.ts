/** Shape of backtest/results.json (written by backtest/make_report.py). Only the fields the UI reads are typed. */
export interface Stats {
  swaps: number
  volume: number
  base_pnl: number
  new_pnl: number
  delta_pnl: number
  delta_pct: number
  pct_swaps_surcharged: number
  pct_volume_surcharged: number
  pct_small_swaps_surcharged: number
  n_small: number
  n_small_sur: number
  nonarb_swaps_surcharged: number
  fair_price_violations: number
  top10_share_of_extra_fee_pct: number
  avg_surcharge_bps?: number
  p99_surcharge_bps?: number
}

export interface PoolResult {
  stock: string
  base_fee_median_bps: number
  basis_applied_bps: number
  baseline: Stats
}

export interface BacktestFile {
  meta: {
    generated: string
    K: number
    SIGMA_MULT: number
    F_MAX: number
    STALE_S: number
    SMALL_USD: number
    sigma_bps_per_sqrt_s: Record<string, number>
    window_5m: [string, string]
    window_1m: [string, string]
  }
  pools: Record<string, PoolResult>
  /** scenario tables; each leaf is { pooled, pooled_core, per_pool } */
  sens: Record<string, unknown>
  pooled_core_baseline: Stats
}

export const POOL_LABELS: Record<string, string> = {
  'NVDAon_v3_0.3': 'NVDAon / USDC, Uniswap v3, 0.3%',
  NVDAon_v4: 'NVDAon / USDC, Uniswap v4',
  TSLAon_v3_1: 'TSLAon / USDC, Uniswap v3, 1%',
  'SPYon_v3_0.3': 'SPYon / USDC, Uniswap v3, 0.3%',
}

/** Pools the headline number is built from. SPYon is excluded: its pool price sits ~91 bps off the stock for an unknown reason. */
export const LOWER_CONFIDENCE = new Set(['SPYon_v3_0.3'])

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function isStats(x: unknown): x is Stats {
  return isObject(x) && typeof x.delta_pnl === 'number' && typeof x.base_pnl === 'number' && typeof x.swaps === 'number'
}

/** Walks f.sens by key path and returns the pooled_core stats of the scenario, or null when any step is missing. */
export function core(f: BacktestFile, ...path: string[]): Stats | null {
  let cur: unknown = f.sens
  for (const k of path) {
    if (!isObject(cur)) return null
    cur = cur[k]
  }
  if (isObject(cur) && isStats(cur.pooled_core)) return cur.pooled_core
  return null
}

export interface StressRow {
  label: string
  note?: string
  stats: Stats | null
}

/** Rows of the stress-test table. Missing scenarios stay in the table as "not in results.json". */
export function stressRows(f: BacktestFile): StressRow[] {
  return [
    { label: 'Baseline: k = 1/2, sigma x1, fee cap 2%, 5-minute reference', stats: f.pooled_core_baseline },
    {
      label: 'Arbitrageur splits each swap into 16 pieces',
      note: 'Fee is recomputed on the running deviation, so later pieces pay less.',
      stats: core(f, 'chunking_adversary', '16'),
    },
    {
      label: '25% of surcharged volume leaves',
      note: 'Pessimistic: the LP keeps that volume\'s losses and loses its fees.',
      stats: core(f, 'elasticity_fees_only_pessimistic', '0.25'),
    },
    {
      label: '50% of surcharged volume leaves',
      note: 'Break-even point for the gain.',
      stats: core(f, 'elasticity_fees_only_pessimistic', '0.5'),
    },
    {
      label: 'All surcharged volume leaves',
      stats: core(f, 'elasticity_fees_only_pessimistic', '1.0'),
    },
    {
      label: 'Reference refreshed every 300 s (same 28-day window as the next row)',
      stats: core(f, 'cadence_28d', '300s (5m bars)', '1.0'),
    },
    {
      label: 'Reference refreshed every 60 s (28-day window)',
      note: 'More swaps are surcharged because the noise allowance shrinks.',
      stats: core(f, 'cadence_28d', '60s (1m bars)', '1.0'),
    },
    { label: 'Noise allowance off (sigma x0)', stats: core(f, 'sigma_mult_5m', '0.0') },
    { label: 'Noise allowance doubled (sigma x2)', stats: core(f, 'sigma_mult_5m', '2.0') },
    { label: 'Fee cap 1%', stats: core(f, 'fee_cap_sweep', 'cap 1%') },
    { label: 'No fee cap', stats: core(f, 'fee_cap_sweep', 'no cap (25%)') },
    { label: 'k = 1/4', stats: core(f, 'k_sweep', '0.25') },
    { label: 'k = 3/4', stats: core(f, 'k_sweep', '0.75') },
    {
      label: 'k = 1',
      note: 'The gain keeps rising with k, so the replay cannot validate k. k = 1/2 comes from the derivation.',
      stats: core(f, 'k_sweep', '1.0'),
    },
    {
      label: 'Lower the base fee to 10 bps',
      note: 'At constant volume this loses most of the fee income.',
      stats: core(f, 'f0_variants', '10 bps'),
    },
  ]
}

function isBacktestFile(x: unknown): x is BacktestFile {
  return (
    isObject(x) &&
    isObject(x.meta) &&
    isObject(x.pools) &&
    isObject(x.sens) &&
    isStats(x.pooled_core_baseline)
  )
}

/** Loads /results.json. Returns null when it is missing or not in the backtest schema. */
export async function loadBacktest(): Promise<BacktestFile | null> {
  try {
    const r = await fetch('/results.json', { cache: 'no-store' })
    if (!r.ok) return null
    const data: unknown = await r.json()
    return isBacktestFile(data) ? data : null
  } catch {
    return null
  }
}

export function usd(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
}

export function signedUsd(n: number): string {
  return (n >= 0 ? '+' : '') + usd(n)
}

export function signedPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}
