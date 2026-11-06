import { computeFee } from '../fee.ts'
import { HistoryBuf, type HistorySample } from './history.ts'
import type { PoolCfg, Reason } from '../types.ts'
import { TICKERS } from './types.ts'
import type {
  Engine,
  EngineState,
  FlowEvent,
  Holding,
  LpPosition,
  MarketRow,
  PoolKind,
  PoolStats,
  PoolView,
  Quote,
  RangePreset,
  ReserveRow,
  Side,
  SimSummary,
  TradeResult,
  Actor,
} from './types.ts'

/**
 * MOCK engine: a self-contained simulation that runs in the browser with no chain.
 * Everything here is invented data. It mirrors the contracts' rule (fee = max(f0, d_eff/2) on
 * arbitrage-direction swaps, f0 otherwise, fail-open when the session is closed) on constant-product
 * pools, one "hook" pool and one flat-fee "control" pool per ticker, so the UI can be used without anvil.
 */

const START: Record<string, { price: number; sigmaBps: number }> = {
  NVDA: { price: 186.9, sigmaBps: 0.85 },
  TSLA: { price: 354.4, sigmaBps: 1.33 },
  AAPL: { price: 231.2, sigmaBps: 0.7 },
  META: { price: 641.5, sigmaBps: 0.95 },
  GOOGL: { price: 289.8, sigmaBps: 0.8 },
  SPY: { price: 681.3, sigmaBps: 0.45 },
}

const F0_BPS = 30
const F_MAX_BPS = 200
const POOL_TVL_USD = 400_000
const ISSUER_FEE_BPS = 10
const TICK_SECONDS = 20
const WARMUP_TICKS = 360 // 2 hours of simulated time
const RANGE: Record<RangePreset, { mult: number; width: number }> = {
  wide: { mult: 1.5, width: 0.4 },
  medium: { mult: 4, width: 0.12 },
  tight: { mult: 12, width: 0.03 },
}

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

interface Acc {
  volume: number
  fees: number
  arbProfit: number
  retailFee: number
  lpPnl: number
  swaps: number
  surcharged: number
  retailSwaps: number
  retailSurcharged: number
}

interface SimPool {
  kind: PoolKind
  x: number
  y: number
  acc: Acc
}

interface SimPosition {
  id: string
  sym: string
  pool: PoolKind
  range: RangePreset
  depositUsd: number
  feesUsd: number
  entryPrice: number
  openedTs: number
}

interface SimTicker {
  sym: string
  name: string
  /** the true price the arbitrageur can see while the session is open */
  ref: number
  oracle: { price: number; ts: number }
  cfg: PoolCfg
  pools: Record<PoolKind, SimPool>
  supply: number
  usdcReserve: number
}

interface FeeInfo {
  feeBps: number
  armed: boolean
  reason: Reason
  toward: boolean
  devBps: number
}

interface Exec {
  out: number
  feeBps: number
  feeUsd: number
  armed: boolean
  reason: Reason
  toward: boolean
  devBps: number
  mid: number
  priceImpactBps: number
}

function emptyAcc(): Acc {
  return { volume: 0, fees: 0, arbProfit: 0, retailFee: 0, lpPnl: 0, swaps: 0, surcharged: 0, retailSwaps: 0, retailSurcharged: 0 }
}

function ilFactor(rho: number): number {
  return (2 * Math.sqrt(rho)) / (1 + rho)
}

export class MockEngine implements Engine {
  mode = 'mock' as const
  syms = TICKERS.map((t) => t.sym)

  private rand = mulberry32(11)
  private tickers = new Map<string, SimTicker>()
  private listeners = new Set<() => void>()
  private events: FlowEvent[] = []
  private eventId = 1
  private positions: SimPosition[] = []
  private posId = 1
  private simTs = Math.floor(Date.now() / 1000)
  private tickN = 0
  private playing = true
  private speed = 1
  private sessionOpen = true
  private timer: number | undefined
  private usdc = 10_000
  private tokens: Record<string, number> = {}
  private basis: Record<string, Holding> = {}
  private state: EngineState
  private hist = new HistoryBuf()

  constructor() {
    for (const t of TICKERS) {
      const s = START[t.sym]
      if (!s) continue
      const x0 = POOL_TVL_USD / 2 / s.price
      const mk = (kind: PoolKind): SimPool => ({ kind, x: x0, y: POOL_TVL_USD / 2, acc: emptyAcc() })
      this.tickers.set(t.sym, {
        sym: t.sym,
        name: t.name,
        ref: s.price,
        oracle: { price: s.price, ts: this.simTs },
        cfg: { f0Bps: F0_BPS, fMaxBps: F_MAX_BPS, sigmaBpsPerRootSec: s.sigmaBps, staleAfterSec: 900 },
        pools: { hook: mk('hook'), control: mk('control') },
        supply: 2 * x0,
        usdcReserve: POOL_TVL_USD,
      })
      this.tokens[t.sym] = 0
      this.basis[t.sym] = { qty: 0, costUsd: 0, realizedUsd: 0 }
    }
    this.state = this.build()
    // Backfill WARMUP_TICKS of simulated history so charts open with data instead of a blank page.
    // The clock is moved back first so the last warm-up tick lands on 'now'.
    this.simTs -= WARMUP_TICKS * TICK_SECONDS
    for (const t of this.tickers.values()) t.oracle = { price: t.ref, ts: this.simTs }
    for (let i = 0; i < WARMUP_TICKS; i++) this.tick()
    this.restartTimer()
  }

  history(sym: string): readonly HistorySample[] {
    return this.hist.get(sym)
  }

  // ---------------------------------------------------------------- engine interface
  getState(): EngineState {
    return this.state
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  dispose(): void {
    window.clearInterval(this.timer)
    this.listeners.clear()
  }

  setPlaying(p: boolean): void {
    this.playing = p
    this.emit()
  }

  setSpeed(s: number): void {
    this.speed = s
    this.restartTimer()
    this.emit()
  }

  newsShock(sym: string, pct: number): void {
    const t = this.tickers.get(sym)
    if (!t) return
    t.ref *= 1 + pct
    this.push({ kind: 'oracle', sym, actor: 'system', detail: `Simulated news shock ${(pct * 100).toFixed(1)}% on ${sym}. The true price moved; the oracle updates on the next tick.` })
    this.emit()
  }

  setSession(open: boolean): void {
    if (open === this.sessionOpen) return
    this.sessionOpen = open
    if (open) {
      for (const t of this.tickers.values()) t.oracle = { price: t.ref, ts: this.simTs }
    }
    this.push({
      kind: 'session',
      actor: 'system',
      detail: open
        ? 'US session OPEN: oracle resumes and arbitrageurs can see the real price.'
        : 'US session CLOSED: no live reference, hook falls back to the base fee, issuer pauses mint and redeem. Pools still trade.',
    })
    this.emit()
  }

  async quote(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number): Promise<Quote> {
    return this.makeQuote(sym, pool, side, amount, slippagePct)
  }

  async trade(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number, minOut?: number): Promise<TradeResult> {
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount above zero.' }
    const t = this.tickers.get(sym)
    if (!t) return { ok: false, error: 'Unknown ticker.' }
    if (side === 'buy' && amount > this.usdc + 1e-9) return { ok: false, error: `Not enough tUSDC (you have ${this.usdc.toFixed(2)}). Use the faucet on the Mint & redeem page.` }
    if (side === 'sell' && amount > (this.tokens[sym] ?? 0) + 1e-9) return { ok: false, error: `You only hold ${(this.tokens[sym] ?? 0).toFixed(4)} t${sym}. This is a spot market: you can sell what you hold, not short.` }
    const q = this.makeQuote(sym, pool, side, amount, slippagePct)
    if (minOut !== undefined && q.amountOut < minOut - 1e-12) {
      return { ok: false, quote: q, error: `Slippage: the price moved since the preview. You would now receive ${q.amountOut.toFixed(6)}, below your minimum ${minOut.toFixed(6)}.` }
    }
    const ex = this.execute(t, pool, side, amount, 'you')
    this.settleUser(sym, side, amount, ex.out)
    this.emit()
    return { ok: true, hash: this.fakeHash(), quote: q, filledOut: ex.out }
  }

  async faucet(): Promise<TradeResult> {
    if (this.usdc >= 1_000_000) return { ok: false, error: 'Faucet limit reached (1,000,000 tUSDC).' }
    this.usdc += 10_000
    this.push({ kind: 'faucet', actor: 'you', detail: 'Faucet: +10,000 tUSDC (test money).', sizeUsd: 10_000 })
    this.emit()
    return { ok: true, hash: this.fakeHash() }
  }

  async mint(sym: string, usdcIn: number): Promise<TradeResult> {
    const t = this.tickers.get(sym)
    if (!t) return { ok: false, error: 'Unknown ticker.' }
    if (!this.primaryOpen(t)) return { ok: false, error: 'Primary market closed: the issuer only mints and redeems while the US session is open and the oracle is fresh. Pools still trade.' }
    if (!(usdcIn > 0)) return { ok: false, error: 'Enter an amount above zero.' }
    if (usdcIn > this.usdc + 1e-9) return { ok: false, error: `Not enough tUSDC (you have ${this.usdc.toFixed(2)}).` }
    const fee = (usdcIn * ISSUER_FEE_BPS) / 1e4
    const tokens = (usdcIn - fee) / t.oracle.price
    this.usdc -= usdcIn
    this.tokens[sym] = (this.tokens[sym] ?? 0) + tokens
    const b = this.basis[sym] ?? { qty: 0, costUsd: 0, realizedUsd: 0 }
    b.qty += tokens
    b.costUsd += usdcIn
    this.basis[sym] = b
    t.supply += tokens
    t.usdcReserve += usdcIn - fee
    this.push({ kind: 'mint', sym, actor: 'issuer', detail: `Minted ${tokens.toFixed(4)} t${sym} for ${usdcIn.toFixed(2)} tUSDC at oracle price $${t.oracle.price.toFixed(2)} (issuer fee ${fee.toFixed(2)}).`, sizeUsd: usdcIn })
    this.emit()
    return { ok: true, hash: this.fakeHash(), filledOut: tokens }
  }

  async redeem(sym: string, tokensIn: number): Promise<TradeResult> {
    const t = this.tickers.get(sym)
    if (!t) return { ok: false, error: 'Unknown ticker.' }
    if (!this.primaryOpen(t)) return { ok: false, error: 'Primary market closed: redemption pauses with the US session. You can still sell the token in a pool.' }
    if (!(tokensIn > 0)) return { ok: false, error: 'Enter an amount above zero.' }
    if (tokensIn > (this.tokens[sym] ?? 0) + 1e-9) return { ok: false, error: `You only hold ${(this.tokens[sym] ?? 0).toFixed(4)} t${sym}.` }
    const gross = tokensIn * t.oracle.price
    const usdcOut = gross - (gross * ISSUER_FEE_BPS) / 1e4
    if (gross > t.usdcReserve) return { ok: false, error: 'Issuer reserve too small for this redemption.' }
    const b = this.basis[sym] ?? { qty: 0, costUsd: 0, realizedUsd: 0 }
    const avg = b.qty > 0 ? b.costUsd / b.qty : 0
    b.realizedUsd += usdcOut - avg * tokensIn
    b.costUsd -= avg * tokensIn
    b.qty -= tokensIn
    this.basis[sym] = b
    this.tokens[sym] = (this.tokens[sym] ?? 0) - tokensIn
    this.usdc += usdcOut
    t.supply -= tokensIn
    t.usdcReserve -= gross
    this.push({ kind: 'redeem', sym, actor: 'issuer', detail: `Redeemed ${tokensIn.toFixed(4)} t${sym} for ${usdcOut.toFixed(2)} tUSDC at oracle price $${t.oracle.price.toFixed(2)} (issuer fee ${(gross - usdcOut).toFixed(2)}).`, sizeUsd: usdcOut })
    this.emit()
    return { ok: true, hash: this.fakeHash(), filledOut: usdcOut }
  }

  async addLiquidity(sym: string, pool: PoolKind, usd: number, range: RangePreset): Promise<TradeResult> {
    const t = this.tickers.get(sym)
    if (!t) return { ok: false, error: 'Unknown ticker.' }
    if (!(usd > 0)) return { ok: false, error: 'Enter an amount above zero.' }
    if (usd > this.usdc + 1e-9) return { ok: false, error: `Not enough tUSDC (you have ${this.usdc.toFixed(2)}).` }
    this.usdc -= usd
    const p = this.poolPrice(t.pools[pool])
    this.positions.push({ id: 'P' + this.posId++, sym, pool, range, depositUsd: usd, feesUsd: 0, entryPrice: p, openedTs: this.simTs })
    this.push({ kind: 'lp', sym, pool, actor: 'you', detail: `Added ${usd.toFixed(2)} tUSDC of liquidity to the ${pool} pool, ${range} range (mock accounting).`, sizeUsd: usd })
    this.emit()
    return { ok: true, hash: this.fakeHash() }
  }

  async removeLiquidity(id: string): Promise<TradeResult> {
    const i = this.positions.findIndex((p) => p.id === id)
    const pos = this.positions[i]
    if (i < 0 || !pos) return { ok: false, error: 'Position not found.' }
    const v = this.positionView(pos)
    this.positions.splice(i, 1)
    this.usdc += v.valueUsd
    this.push({ kind: 'lp', sym: pos.sym, pool: pos.pool, actor: 'you', detail: `Removed position ${pos.id}: ${v.valueUsd.toFixed(2)} tUSDC back (fees ${v.feesUsd.toFixed(2)}).`, sizeUsd: v.valueUsd })
    this.emit()
    return { ok: true, hash: this.fakeHash() }
  }

  // ---------------------------------------------------------------- simulation
  private restartTimer(): void {
    window.clearInterval(this.timer)
    this.timer = window.setInterval(() => {
      if (this.playing) this.tick()
    }, 900 / this.speed)
  }

  private normal(): number {
    const u = Math.max(this.rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand())
  }

  private tick(): void {
    this.tickN++
    this.simTs += TICK_SECONDS
    for (const t of this.tickers.values()) {
      const sig = t.cfg.sigmaBpsPerRootSec * 1e-4
      t.ref *= Math.exp(sig * Math.sqrt(TICK_SECONDS) * this.normal() - 0.5 * sig * sig * TICK_SECONDS)
      if (this.sessionOpen) {
        t.oracle = { price: t.ref, ts: this.simTs }
        if (this.tickN % 6 === 0) this.push({ kind: 'oracle', sym: t.sym, actor: 'oracle', detail: `Oracle update ${t.sym}: $${t.ref.toFixed(2)} (session open).` })
      }
      // retail: the same order hits both pools so they can be compared
      if (this.rand() < 0.55) {
        const side: Side = this.rand() < 0.5 ? 'buy' : 'sell'
        const usd = Math.min(5000, Math.exp(5.4 + 0.9 * this.normal()))
        for (const k of ['hook', 'control'] as const) {
          const pool = t.pools[k]
          const amt = side === 'buy' ? usd : usd / this.poolPrice(pool)
          this.execute(t, k, side, amt, 'retail')
        }
      }
      // arbitrageur: only while the session is open (it needs a real price to trade against)
      if (this.sessionOpen) for (const k of ['hook', 'control'] as const) this.arb(t, k)
    }
    this.emit()
  }

  private arb(t: SimTicker, k: PoolKind): void {
    const pool = t.pools[k]
    for (let chunk = 0; chunk < 3; chunk++) {
      const p = this.poolPrice(pool)
      const side: Side = p < t.ref ? 'buy' : 'sell'
      const info = this.feeInfo(t, k, side)
      const dev = Math.abs(p / t.ref - 1) * 1e4
      if (dev <= info.feeBps + 1) return
      const target = t.ref * (side === 'buy' ? 1 - info.feeBps / 1e4 : 1 + info.feeBps / 1e4)
      const step = p + (target - p) / (3 - chunk)
      const kk = pool.x * pool.y
      let gross: number
      if (side === 'buy') gross = (Math.sqrt(kk * step) - pool.y) / (1 - info.feeBps / 1e4)
      else gross = (Math.sqrt(kk / step) - pool.x) / (1 - info.feeBps / 1e4)
      if (!(gross > 0) || !Number.isFinite(gross)) return
      this.execute(t, k, side, gross, 'arb')
    }
  }

  // ---------------------------------------------------------------- pool math
  private poolPrice(p: SimPool): number {
    return p.y / p.x
  }

  private primaryOpen(t: SimTicker): boolean {
    return this.sessionOpen && this.simTs - t.oracle.ts <= t.cfg.staleAfterSec
  }

  private feeInfo(t: SimTicker, k: PoolKind, side: Side): FeeInfo {
    const pool = t.pools[k]
    const p = this.poolPrice(pool)
    const toward = side === 'buy' ? p < t.oracle.price : p > t.oracle.price
    const devBps = Math.abs(p / t.oracle.price - 1) * 1e4
    if (k === 'control') return { feeBps: F0_BPS, armed: false, reason: 'no-reference', toward, devBps }
    const out = computeFee({
      poolPrice: p,
      refPrice: t.oracle.price,
      ageSec: this.simTs - t.oracle.ts,
      towardRef: toward,
      sessionOpen: this.sessionOpen,
      cfg: t.cfg,
    })
    return { feeBps: out.feeBps, armed: out.armed, reason: out.reason, toward, devBps }
  }

  private swapMath(pool: SimPool, side: Side, amountIn: number, feeBps: number): { out: number; x: number; y: number; impactBps: number } {
    const fee = feeBps / 1e4
    const eff = amountIn * (1 - fee)
    const mid = this.poolPrice(pool)
    if (side === 'buy') {
      const out = pool.x - (pool.x * pool.y) / (pool.y + eff)
      const x = pool.x - out
      const y = pool.y + amountIn
      return { out, x, y, impactBps: Math.abs(amountIn / out / mid - 1) * 1e4 }
    }
    const out = pool.y - (pool.x * pool.y) / (pool.x + eff)
    const x = pool.x + amountIn
    const y = pool.y - out
    return { out, x, y, impactBps: Math.abs(out / amountIn / mid - 1) * 1e4 }
  }

  private makeQuote(sym: string, kind: PoolKind, side: Side, amount: number, slippagePct: number): Quote {
    const t = this.tickers.get(sym)
    if (!t) throw new Error('unknown ticker ' + sym)
    const pool = t.pools[kind]
    const info = this.feeInfo(t, kind, side)
    const m = this.swapMath(pool, side, Math.max(amount, 0), info.feeBps)
    const mid = this.poolPrice(pool)
    const other: PoolKind = kind === 'hook' ? 'control' : 'hook'
    const oInfo = this.feeInfo(t, other, side)
    const oPool = t.pools[other]
    const oM = this.swapMath(oPool, side, Math.max(amount, 0), oInfo.feeBps)
    const feeUsd = side === 'buy' ? amount * (info.feeBps / 1e4) : amount * mid * (info.feeBps / 1e4)
    const execPrice = side === 'buy' ? (m.out > 0 ? amount / m.out : mid) : amount > 0 ? m.out / amount : mid
    return {
      sym,
      pool: kind,
      side,
      amountIn: amount,
      amountOut: m.out,
      midPriceUsd: mid,
      execPriceUsd: execPrice,
      priceImpactBps: m.impactBps,
      feeBps: info.feeBps,
      baseFeeBps: F0_BPS,
      feeUsd,
      armed: info.armed,
      reason: info.reason,
      towardRef: info.toward,
      devBps: info.devBps,
      refPriceUsd: t.oracle.price,
      otherPoolOut: oM.out,
      otherPoolFeeBps: oInfo.feeBps,
      minOut: m.out * (1 - slippagePct / 100),
    }
  }

  private execute(t: SimTicker, kind: PoolKind, side: Side, amountIn: number, actor: Actor): Exec {
    const pool = t.pools[kind]
    const info = this.feeInfo(t, kind, side)
    const mid = this.poolPrice(pool)
    const m = this.swapMath(pool, side, amountIn, info.feeBps)
    const usd = side === 'buy' ? amountIn : m.out
    const feeUsd = side === 'buy' ? amountIn * (info.feeBps / 1e4) : amountIn * mid * (info.feeBps / 1e4)
    // LP gain against the true price, the same markout the backtest uses
    const lpGain = side === 'buy' ? amountIn - m.out * t.ref : amountIn * t.ref - m.out
    pool.x = m.x
    pool.y = m.y
    const a = pool.acc
    a.volume += usd
    a.fees += feeUsd
    a.lpPnl += lpGain
    a.swaps++
    if (info.armed) a.surcharged++
    if (actor === 'arb') a.arbProfit += -lpGain
    if (actor === 'retail' || actor === 'you') {
      a.retailFee += feeUsd
      a.retailSwaps++
      if (info.armed) a.retailSurcharged++
    }
    this.creditLps(t.sym, kind, feeUsd, mid)
    this.push({
      kind: 'swap',
      sym: t.sym,
      pool: kind,
      actor,
      detail: `${actor === 'you' ? 'You' : actor === 'arb' ? 'Arbitrageur' : 'Retail'} ${side === 'buy' ? 'bought' : 'sold'} t${t.sym} in the ${kind} pool`,
      sizeUsd: usd,
      feeBps: info.feeBps,
      baseFeeBps: F0_BPS,
      armed: info.armed,
      towardRef: info.toward,
    })
    return { out: m.out, feeBps: info.feeBps, feeUsd, armed: info.armed, reason: info.reason, toward: info.toward, devBps: info.devBps, mid, priceImpactBps: m.impactBps }
  }

  private settleUser(sym: string, side: Side, amountIn: number, out: number): void {
    const b = this.basis[sym] ?? { qty: 0, costUsd: 0, realizedUsd: 0 }
    if (side === 'buy') {
      this.usdc -= amountIn
      this.tokens[sym] = (this.tokens[sym] ?? 0) + out
      b.qty += out
      b.costUsd += amountIn
    } else {
      const avg = b.qty > 0 ? b.costUsd / b.qty : 0
      b.realizedUsd += out - avg * amountIn
      b.costUsd -= avg * amountIn
      b.qty -= amountIn
      this.tokens[sym] = (this.tokens[sym] ?? 0) - amountIn
      this.usdc += out
    }
    this.basis[sym] = b
  }

  // ---------------------------------------------------------------- LP accounting (illustrative)
  private creditLps(sym: string, kind: PoolKind, feeUsd: number, price: number): void {
    const mine = this.positions.filter((p) => p.sym === sym && p.pool === kind)
    if (mine.length === 0) return
    let weight = POOL_TVL_USD
    const active: { p: SimPosition; w: number }[] = []
    for (const p of mine) {
      const r = RANGE[p.range]
      const inRange = Math.abs(price / p.entryPrice - 1) <= r.width
      const w = inRange ? p.depositUsd * r.mult : 0
      weight += w
      if (w > 0) active.push({ p, w })
    }
    for (const { p, w } of active) p.feesUsd += (feeUsd * w) / weight
  }

  private positionView(p: SimPosition): LpPosition {
    const t = this.tickers.get(p.sym)
    const r = RANGE[p.range]
    const price = t ? this.poolPrice(t.pools[p.pool]) : p.entryPrice
    const rho = price / p.entryPrice
    const clamped = Math.min(1 + r.width, Math.max(1 / (1 + r.width), rho))
    const hold = p.depositUsd * (0.5 + 0.5 * rho)
    const lp = hold * (1 + r.mult * (ilFactor(clamped) - 1)) + p.feesUsd
    return {
      id: p.id,
      sym: p.sym,
      pool: p.pool,
      range: p.range,
      depositUsd: p.depositUsd,
      feesUsd: p.feesUsd,
      valueUsd: lp,
      vsHoldUsd: lp - hold,
      inRange: Math.abs(rho - 1) <= r.width,
      openedTs: p.openedTs,
    }
  }

  // ---------------------------------------------------------------- state
  private push(e: Omit<FlowEvent, 'id' | 'ts'>): void {
    this.events.push({ id: this.eventId++, ts: this.simTs, ...e })
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500)
  }

  private fakeHash(): string {
    let s = '0x'
    for (let i = 0; i < 64; i++) s += Math.floor(this.rand() * 16).toString(16)
    return s
  }

  private emit(): void {
    this.state = this.build()
    this.hist.record(this.state)
    for (const l of this.listeners) l()
  }

  private poolView(t: SimTicker, k: PoolKind): PoolView {
    const pool = t.pools[k]
    const price = this.poolPrice(pool)
    const buy = this.feeInfo(t, k, 'buy')
    const sell = this.feeInfo(t, k, 'sell')
    return {
      priceUsd: price,
      devBps: buy.devBps,
      feeBuyBps: buy.feeBps,
      feeSellBps: sell.feeBps,
      baseFeeBps: F0_BPS,
      tvlUsd: pool.x * price + pool.y,
    }
  }

  private statsOf(a: Acc): PoolStats {
    return {
      volumeUsd: a.volume,
      feesUsd: a.fees,
      arbProfitUsd: a.arbProfit,
      retailFeePaidUsd: a.retailFee,
      lpPnlUsd: a.lpPnl,
      swapsSurchargedPct: a.swaps ? (a.surcharged / a.swaps) * 100 : 0,
      retailSurchargedPct: a.retailSwaps ? (a.retailSurcharged / a.retailSwaps) * 100 : 0,
      swaps: a.swaps,
    }
  }

  private build(): EngineState {
    const markets: MarketRow[] = []
    const reserves: ReserveRow[] = []
    const summary: SimSummary = { source: 'mock', tickers: {} }
    for (const t of this.tickers.values()) {
      markets.push({
        sym: t.sym,
        name: t.name,
        refPriceUsd: t.oracle.price,
        refAgeSec: this.simTs - t.oracle.ts,
        sessionOpen: this.sessionOpen,
        hook: this.poolView(t, 'hook'),
        control: this.poolView(t, 'control'),
      })
      const supplyValue = t.supply * t.oracle.price
      reserves.push({
        sym: t.sym,
        supply: t.supply,
        usdcReserve: t.usdcReserve,
        supplyValueUsd: supplyValue,
        oraclePriceUsd: t.oracle.price,
        backingRatio: supplyValue > 0 ? t.usdcReserve / supplyValue : 1,
        fullyBacked: t.usdcReserve >= supplyValue,
      })
      summary.tickers[t.sym] = { hook: this.statsOf(t.pools.hook.acc), control: this.statsOf(t.pools.control.acc) }
    }
    return {
      mode: 'mock',
      issuerFeeBps: ISSUER_FEE_BPS,
      sourceNote: 'MOCK: simulated in your browser. Invented prices and flow, test tokens only, no chain, nothing is real money or real stock.',
      markets,
      wallet: {
        address: 'mock-wallet',
        usdc: this.usdc,
        tokens: { ...this.tokens },
        basis: Object.fromEntries(Object.entries(this.basis).map(([k, v]) => [k, { ...v }])),
      },
      events: this.events.slice(),
      positions: this.positions.map((p) => this.positionView(p)),
      reserves,
      summary,
      sim: { playing: this.playing, speed: this.speed, simTs: this.simTs },
    }
  }
}
