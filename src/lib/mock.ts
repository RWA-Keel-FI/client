import { computeFee, DEFAULT_CFG } from './fee.ts'
import type { PoolCfg, SwapRow } from './types.ts'

/** Deterministic PRNG so the replay looks the same on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * MOCK data. A random-walk reference price, an oracle that refreshes once a minute,
 * a pool that only moves through swaps, retail swaps in both directions, and an arbitrageur
 * that trades toward the reference when the pool is mispriced. News jumps are injected on purpose.
 * This is not market data and must be labelled as mock in the UI.
 */
export function generateMockSwaps(cfg: PoolCfg = DEFAULT_CFG, n = 160, seed = 7): SwapRow[] {
  const rand = mulberry32(seed)
  const tvlUsd = 3_000_000
  const sigma = cfg.sigmaBpsPerRootSec * 1e-4 // per root second
  const dt = 20 // seconds between simulated steps
  const oracleEvery = 60
  const jumpAt = new Map<number, number>([
    [30, 0.012],
    [75, -0.009],
    [120, 0.010],
  ])

  let t = 1_790_000_000
  let ref = 186.9
  let pool = 186.9
  let oraclePrice = ref
  let oracleTs = t
  const rows: SwapRow[] = []
  let step = 0
  while (rows.length < n && step < n * 40) {
    step++
    t += dt
    ref *= 1 + sigma * Math.sqrt(dt) * normal(rand)
    for (const [k, v] of jumpAt) {
      if (rows.length >= k) {
        ref *= 1 + v // news jump
        jumpAt.delete(k)
      }
    }
    if (t - oracleTs >= oracleEvery) {
      oraclePrice = ref
      oracleTs = t
    }
    const age = t - oracleTs
    const dev = pool / oraclePrice - 1

    const pushSwap = (towardRef: boolean, sizeUsd: number) => {
      const out = computeFee({
        poolPrice: pool,
        refPrice: oraclePrice,
        ageSec: age,
        towardRef,
        sessionOpen: true,
        cfg,
      })
      const impact = (2 * sizeUsd) / tvlUsd
      // selling the stock into the pool pushes the pool price down, buying pushes it up
      const poolAbove = pool > oraclePrice
      const sell = towardRef ? poolAbove : !poolAbove
      pool *= 1 + (sell ? -impact : impact)
      rows.push({
        id: `mock-${rows.length}`,
        ts: t,
        pool: 'tNVDA/USDC (mock)',
        sizeUsd,
        towardRef,
        deviationBps: out.dEffBps,
        baseFeeBps: cfg.f0Bps,
        chargedFeeBps: out.feeBps,
        armed: out.armed,
        reason: out.reason,
        ageSec: age,
      })
    }

    // retail: small, random direction
    if (rand() < 0.45) {
      const sizeUsd = Math.exp(5.2 + 1.1 * normal(rand)) // median about 180 USD
      const sell = rand() < 0.5
      const poolAbove = pool > oraclePrice
      pushSwap(sell === poolAbove, sizeUsd)
    }
    // arbitrageur: trades toward the reference once the pool is off by more than the base fee
    if (Math.abs(dev) * 1e4 > cfg.f0Bps && rand() < 0.85) {
      const needUsd = Math.abs(dev) * tvlUsd * 0.5
      pushSwap(true, Math.max(needUsd * (0.85 + rand() * 0.15), 200))
    }
  }
  return rows.slice(0, n)
}
