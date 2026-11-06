import type { Reason } from '../types.ts'
import type { HistorySample } from './history.ts'

/** Everything the new pages need, independent of whether the data is simulated in the browser or read from anvil. */
export type Side = 'buy' | 'sell'
export type PoolKind = 'hook' | 'control'
export type Actor = 'retail' | 'arb' | 'you' | 'lp' | 'issuer' | 'oracle' | 'system'
export type RangePreset = 'wide' | 'medium' | 'tight'
export type EngineMode = 'mock' | 'chain'

export interface PoolView {
  priceUsd: number
  /** |pool / reference - 1| in bps (raw, before the noise allowance) */
  devBps: number
  /** fee a buy / sell would pay right now, in bps */
  feeBuyBps: number
  feeSellBps: number
  baseFeeBps: number
  tvlUsd: number
}

export interface MarketRow {
  sym: string
  name: string
  refPriceUsd: number
  refAgeSec: number
  sessionOpen: boolean
  hook: PoolView
  control: PoolView
}

export interface Quote {
  sym: string
  pool: PoolKind
  side: Side
  /** amount you pay: tUSDC for buy, tokens for sell */
  amountIn: number
  /** amount you get, after the fee */
  amountOut: number
  midPriceUsd: number
  execPriceUsd: number
  priceImpactBps: number
  feeBps: number
  baseFeeBps: number
  feeUsd: number
  armed: boolean
  reason: Reason
  /** true when this swap moves the pool toward the reference price */
  towardRef: boolean
  devBps: number
  refPriceUsd: number
  /** same trade in the other pool, for comparison */
  otherPoolOut: number
  otherPoolFeeBps: number
  /** amountOut after applying the slippage tolerance */
  minOut: number
}

export interface TradeResult {
  ok: boolean
  hash?: string
  error?: string
  quote?: Quote
  filledOut?: number
}

export interface Holding {
  qty: number
  costUsd: number
  /** profit already locked in by selling or redeeming, USD */
  realizedUsd: number
}

export interface Wallet {
  address: string
  usdc: number
  tokens: Record<string, number>
  /** average-cost basis of tokens you bought in the pools or minted */
  basis: Record<string, Holding>
}

export interface LpPosition {
  id: string
  sym: string
  pool: PoolKind
  range: RangePreset
  depositUsd: number
  /** fees credited to this position, USD */
  feesUsd: number
  valueUsd: number
  /** value minus what the same deposit would be worth if just held */
  vsHoldUsd: number
  inRange: boolean
  openedTs: number
}

export interface FlowEvent {
  id: number
  ts: number
  kind: 'oracle' | 'session' | 'swap' | 'mint' | 'redeem' | 'lp' | 'faucet'
  sym?: string
  pool?: PoolKind
  actor: Actor
  detail: string
  sizeUsd?: number
  feeBps?: number
  baseFeeBps?: number
  armed?: boolean
  towardRef?: boolean
}

export interface ReserveRow {
  sym: string
  supply: number
  /** tUSDC the issuer holds against this token */
  usdcReserve: number
  /** supply x oracle price, in tUSDC */
  supplyValueUsd: number
  oraclePriceUsd: number
  /** usdcReserve / supplyValueUsd */
  backingRatio: number
  fullyBacked: boolean
}

export interface PoolStats {
  volumeUsd: number
  feesUsd: number
  arbProfitUsd: number
  retailFeePaidUsd: number
  lpPnlUsd: number
  swapsSurchargedPct: number
  retailSurchargedPct: number
  swaps: number
}

export interface SimSummary {
  source: 'mock' | 'file'
  tickers: Record<string, { hook: PoolStats; control: PoolStats }>
}

export interface EngineState {
  mode: EngineMode
  /** human text about where the data comes from */
  sourceNote: string
  /** fee the issuer takes on mint and redeem, in bps */
  issuerFeeBps: number
  markets: MarketRow[]
  wallet: Wallet
  events: FlowEvent[]
  positions: LpPosition[]
  reserves: ReserveRow[]
  summary: SimSummary | null
  sim: { playing: boolean; speed: number; simTs: number }
  error?: string
}

export interface Engine {
  mode: EngineMode
  syms: string[]
  /** price samples for one stock, oldest first (mutated in place; re-read when state changes) */
  history(sym: string): readonly HistorySample[]
  getState(): EngineState
  subscribe(fn: () => void): () => void
  quote(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number): Promise<Quote>
  /** minOut: the minimum you saw in the preview; the trade fails if the fresh quote is below it */
  trade(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number, minOut?: number): Promise<TradeResult>
  faucet(): Promise<TradeResult>
  mint(sym: string, usdcIn: number): Promise<TradeResult>
  redeem(sym: string, tokensIn: number): Promise<TradeResult>
  addLiquidity(sym: string, pool: PoolKind, usd: number, range: RangePreset): Promise<TradeResult>
  removeLiquidity(id: string): Promise<TradeResult>
  /** simulation controls; no-ops in chain mode */
  setPlaying(p: boolean): void
  setSpeed(s: number): void
  newsShock(sym: string, pct: number): void
  setSession(open: boolean): void
  dispose(): void
}

export const TICKERS: { sym: string; name: string }[] = [
  { sym: 'NVDA', name: 'NVIDIA' },
  { sym: 'TSLA', name: 'Tesla' },
  { sym: 'AAPL', name: 'Apple' },
  { sym: 'META', name: 'Meta Platforms' },
  { sym: 'GOOGL', name: 'Alphabet' },
  { sym: 'SPY', name: 'S&P 500 ETF' },
]

export function tokenName(sym: string): string {
  return 't' + sym
}
