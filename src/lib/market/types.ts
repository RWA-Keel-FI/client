import type { Address } from 'viem'
import type { Reason } from '../types.ts'
import type { HistorySample } from './history.ts'

/** Everything the pages need. All of it is read from Arc Testnet; nothing is simulated in the browser. */
export type Side = 'buy' | 'sell'
export type PoolKind = 'hook' | 'control'
export type Actor = 'you' | 'other' | 'oracle' | 'issuer' | 'lp'
export type RangePreset = 'wide' | 'medium' | 'tight'

export interface PoolView {
  priceUsd: number
  /** |pool / reference - 1| in bps (raw, before the noise allowance) */
  devBps: number
  /** fee a buy / sell would pay right now, in bps (read from the hook's quoteFee, or the pool's flat fee for a control pool) */
  feeBuyBps: number
  feeSellBps: number
  baseFeeBps: number
  /** value of the pool's active liquidity at the current price, USD */
  tvlUsd: number
  /** USD volume of the swaps seen in the loaded event window */
  volumeUsd: number
}

export interface MarketRow {
  sym: string
  name: string
  refPriceUsd: number
  refAgeSec: number
  sessionOpen: boolean
  /** seconds after which the hook treats the reference as stale and falls back to the base fee */
  maxAgeSec: number
  /** true when the reference is older than maxAgeSec */
  stale: boolean
  /** StockIssuer.primaryMarketOpen: mint and redeem work (session open and the price is fresh) */
  primaryOpen: boolean
  /** the hook's fee ceiling, bps */
  feeMaxBps: number
  hook: PoolView
  /** null when the deployment has no control pool for this ticker */
  control: PoolView | null
}

export interface Quote {
  sym: string
  pool: PoolKind
  side: Side
  /** amount you pay: USDC for buy, tokens for sell */
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
  /** same trade in the other pool, for comparison (null without a control pool) */
  otherPoolOut: number | null
  otherPoolFeeBps: number | null
  /** amountOut after applying the slippage tolerance */
  minOut: number
  /** true when amountOut came from simulating the swap on chain (eth_call), false for the constant-product estimate */
  exact: boolean
}

/** Progress of a multi-transaction flow, for the UI. */
export interface TxStep {
  phase: 'approve-sign' | 'approve-pending' | 'sign' | 'pending'
  hash?: string
}

export interface TradeResult {
  ok: boolean
  hash?: string
  approveHash?: string
  error?: string
  quote?: Quote
  filledOut?: number
}

export interface Wallet {
  address: string
  /** ERC-20 USDC balance (6 decimals) */
  usdc: number
  /** native gas balance (USDC with 18 decimals) */
  native: number
  tokens: Record<string, number>
}

export interface LpPosition {
  id: string
  sym: string
  pool: PoolKind
  tickLower: number
  tickUpper: number
  lowerUsd: number
  upperUsd: number
  liquidity: string
  stock: number
  usdc: number
  valueUsd: number
  inRange: boolean
}

export interface FlowEvent {
  id: number
  ts: number
  block: number
  tx: string
  kind: 'oracle' | 'swap' | 'mint' | 'redeem' | 'lp'
  sym?: string
  pool?: PoolKind
  actor: Actor
  detail: string
  sizeUsd?: number
  feeBps?: number
  baseFeeBps?: number
  armed?: boolean
}

/** One FeeSet event emitted by the hook in beforeSwap. */
export interface FeeEventRow {
  id: string
  ts: number
  block: number
  tx: string
  sym: string
  feeBps: number
  baseFeeBps: number
  /** FeeSet.deviationBps: the deviation net of reference noise */
  netDevBps: number
  armed: boolean
}

export interface ReserveRow {
  sym: string
  supply: number
  /** USDC the issuer holds against this token (plus the shared buffer) */
  usdcReserve: number
  /** supply x oracle price, in USDC */
  supplyValueUsd: number
  oraclePriceUsd: number
  /** usdcReserve / supplyValueUsd */
  backingRatio: number
  fullyBacked: boolean
}

export interface EngineState {
  ready: boolean
  /** fee the issuer takes on mint and redeem, in bps */
  issuerFeeBps: number
  markets: MarketRow[]
  wallet: Wallet
  events: FlowEvent[]
  feeEvents: FeeEventRow[]
  positions: LpPosition[]
  reserves: ReserveRow[]
  /** latest block timestamp seen, seconds */
  chainTs: number
  blockNumber: number
  error?: string
}

export interface Engine {
  syms: string[]
  usdcAddress: Address
  tokenAddress(sym: string): Address | undefined
  /** price samples for one stock, oldest first (mutated in place; re-read when state changes) */
  history(sym: string): readonly HistorySample[]
  getState(): EngineState
  subscribe(fn: () => void): () => void
  setAccount(address: Address | undefined): void
  refresh(): Promise<void>
  quote(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number): Promise<Quote>
  /** minOut: the minimum you saw in the preview; the trade fails if the fresh quote is below it */
  trade(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number, minOut?: number, onStep?: (s: TxStep) => void): Promise<TradeResult>
  mint(sym: string, usdcIn: number, onStep?: (s: TxStep) => void): Promise<TradeResult>
  redeem(sym: string, tokensIn: number, onStep?: (s: TxStep) => void): Promise<TradeResult>
  addLiquidity(sym: string, pool: PoolKind, usd: number, range: RangePreset, onStep?: (s: TxStep) => void): Promise<TradeResult>
  removeLiquidity(id: string, onStep?: (s: TxStep) => void): Promise<TradeResult>
  dispose(): void
}

/** Display names for the tickers the project knows about. A ticker in the deployment that is not listed here shows its symbol. */
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
