import { createPublicClient, createWalletClient, encodeAbiParameters, formatUnits, getAbiItem, http, keccak256, parseUnits } from 'viem'
import type { Abi, AbiEvent, Address, Hex, PublicClient, WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Reason } from '../types.ts'
import { HistoryBuf, type HistorySample } from './history.ts'
import { TICKERS } from './types.ts'
import type {
  Actor,
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
} from './types.ts'

/**
 * CHAIN engine: reads and writes the local anvil deployment (chain 31337) through viem.
 * ABIs come from /deployments/abi/<Name>.json (copied by `pnpm sync-deployments`), addresses from /deployments/local.json.
 * The signer is anvil's public test key for the "retail" account. It is read from VITE_RETAIL_PK, and defaults to anvil
 * account #5, whose key is published in every anvil install. Never put a real key here.
 */

interface PoolKeyJson {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

interface TickerDeploy {
  feedId: Hex
  token: Address
  startPriceE8?: number
  stockIsCurrency0?: boolean
  hookPool: { poolId: Hex; key: PoolKeyJson }
  controlPool: { poolId: Hex; key: PoolKeyJson }
}

export interface Deployment {
  chainId: number
  rpc: string
  poolManager: Address
  oracle: Address
  hook: Address
  usdc: Address
  issuer: Address
  swapRouter: Address
  liquidityRouter: Address
  baseFeePips?: number
  accounts?: { deployer?: string; lps?: string[]; arb?: string; retail?: string }
  tickers: Record<string, TickerDeploy>
}

const ABI_FILES = {
  oracle: 'RefPriceOracle',
  hook: 'DeviationFeeHook',
  pm: 'PoolManager',
  usdc: 'MockUSDC',
  token: 'StockToken',
  issuer: 'StockIssuer',
  router: 'SwapRouter',
  lrouter: 'LiquidityRouter',
} as const
type AbiKey = keyof typeof ABI_FILES
type Abis = Record<AbiKey, Abi>

async function loadAbi(file: string): Promise<Abi> {
  const r = await fetch(`/deployments/abi/${file}.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`ABI ${file}.json not found. Run the deploy, then \`pnpm sync-deployments\`.`)
  const j: unknown = await r.json()
  const abi = Array.isArray(j) ? j : (j as { abi?: unknown }).abi
  if (!Array.isArray(abi)) throw new Error(`ABI ${file}.json has an unexpected shape.`)
  return abi as Abi
}

export async function loadDeployment(): Promise<Deployment | null> {
  try {
    const r = await fetch('/deployments/local.json', { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as Deployment
    return j && j.tickers ? j : null
  } catch {
    return null
  }
}

const POOLS_SLOT = 6n
/** anvil's published default account #5 (the deployment's "retail" account). Public test key, worth nothing. */
const ANVIL_RETAIL_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
/** ticks for a +/- range around the current tick: ~40%, ~12%, ~3% (1.0001^ticks) */
const RANGE_TICKS: Record<RangePreset, number> = { wide: 3365, medium: 1133, tight: 296 }
const USDC_DEC = 6
const TOKEN_DEC = 18

function poolSlot(poolId: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, POOLS_SLOT])))
}

function toHex32(n: bigint): Hex {
  return ('0x' + n.toString(16).padStart(64, '0')) as Hex
}

function sqrtAtTick(tick: number): number {
  return Math.pow(1.0001, tick / 2)
}

interface StoredPos {
  id: string
  sym: string
  pool: PoolKind
  range: RangePreset
  depositUsd: number
  tickLower: number
  tickUpper: number
  openedTs: number
}

interface PoolSnap {
  priceUsd: number
  tick: number
  sqrtP: number
  liquidity: number
  stockVirt: number
  usdcVirt: number
}

interface RawLog {
  args: Record<string, unknown>
  transactionHash: Hex
  blockNumber: bigint
  logIndex: number
}

export class ChainEngine implements Engine {
  mode = 'chain' as const
  syms: string[]

  private pub: PublicClient
  private wallet: WalletClient
  private account: ReturnType<typeof privateKeyToAccount>
  private dep: Deployment
  private abis: Abis
  private listeners = new Set<() => void>()
  private events: FlowEvent[] = []
  private eventId = 1
  private lastBlock = 0n
  private blockTs = new Map<bigint, number>()
  private timer: number | undefined
  private state: EngineState
  private issuerFeeBps = 0
  private positions: StoredPos[] = []
  private basis: Record<string, Holding> = {}
  private busy = false

  private constructor(dep: Deployment, abis: Abis) {
    this.dep = dep
    this.abis = abis
    this.syms = TICKERS.map((t) => t.sym).filter((s) => dep.tickers[s])
    const rpc = (import.meta.env.VITE_RPC_URL as string | undefined) ?? dep.rpc
    this.pub = createPublicClient({ transport: http(rpc) })
    this.account = privateKeyToAccount(((import.meta.env.VITE_RETAIL_PK as string | undefined) ?? ANVIL_RETAIL_KEY) as Hex)
    this.wallet = createWalletClient({ account: this.account, transport: http(rpc) })
    try {
      this.positions = JSON.parse(localStorage.getItem(`dfee.pos.${this.account.address}`) ?? '[]') as StoredPos[]
      this.basis = JSON.parse(localStorage.getItem(`dfee.basis.${this.account.address}`) ?? '{}') as Record<string, Holding>
    } catch {
      this.positions = []
      this.basis = {}
    }
    this.state = this.empty()
  }

  static async create(): Promise<ChainEngine> {
    const dep = await loadDeployment()
    if (!dep) throw new Error('No /deployments/local.json found. Start anvil, deploy, then run `pnpm sync-deployments`.')
    const entries = await Promise.all((Object.entries(ABI_FILES) as [AbiKey, string][]).map(async ([k, f]) => [k, await loadAbi(f)] as const))
    const abis = Object.fromEntries(entries) as Abis
    const e = new ChainEngine(dep, abis)
    const cid = await e.pub.getChainId()
    if (cid !== dep.chainId) throw new Error(`RPC is on chain ${cid}, the deployment is for ${dep.chainId}. Is anvil running?`)
    e.issuerFeeBps = Number(await e.read(dep.issuer, abis.issuer, 'FEE_BPS', []))
    await e.refresh()
    e.timer = window.setInterval(() => void e.refresh(), 3000)
    return e
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
  setPlaying(): void {}
  setSpeed(): void {}
  newsShock(): void {}
  setSession(): void {}

  async quote(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number): Promise<Quote> {
    const t = this.tk(sym)
    const snap = await this.snap(sym, pool)
    const otherKind: PoolKind = pool === 'hook' ? 'control' : 'hook'
    const otherSnap = await this.snap(sym, otherKind)
    const zfo = this.zeroForOne(sym, side)
    const [feeBps, armed, toward, reason] = await this.feeFor(sym, pool, zfo)
    const [oFee] = await this.feeFor(sym, otherKind, zfo)
    const out = this.estimate(snap, side, amount, feeBps)
    const oOut = this.estimate(otherSnap, side, amount, oFee)
    const ref = await this.refPrice(sym)
    const mid = snap.priceUsd
    const execPrice = side === 'buy' ? (out > 0 ? amount / out : mid) : amount > 0 ? out / amount : mid
    return {
      sym,
      pool,
      side,
      amountIn: amount,
      amountOut: out,
      midPriceUsd: mid,
      execPriceUsd: execPrice,
      priceImpactBps: mid > 0 ? Math.abs(execPrice / mid - 1) * 1e4 : 0,
      feeBps,
      baseFeeBps: this.baseFeeBps(t, pool),
      feeUsd: side === 'buy' ? amount * (feeBps / 1e4) : amount * mid * (feeBps / 1e4),
      armed,
      reason,
      towardRef: toward,
      devBps: ref.price > 0 ? Math.abs(mid / ref.price - 1) * 1e4 : 0,
      refPriceUsd: ref.price,
      otherPoolOut: oOut,
      otherPoolFeeBps: oFee,
      minOut: out * (1 - slippagePct / 100),
    }
  }

  async trade(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number, minOut?: number): Promise<TradeResult> {
    return this.guard(async () => {
      const q = await this.quote(sym, pool, side, amount, slippagePct)
      if (minOut !== undefined && q.amountOut < minOut) return { ok: false, quote: q, error: 'Slippage: the price moved since the preview.' }
      const t = this.tk(sym)
      const key = this.keyOf(t, pool)
      const inAddr = side === 'buy' ? this.dep.usdc : t.token
      const inDec = side === 'buy' ? USDC_DEC : TOKEN_DEC
      const outAddr = side === 'buy' ? t.token : this.dep.usdc
      const outDec = side === 'buy' ? TOKEN_DEC : USDC_DEC
      const raw = parseUnits(amount.toFixed(inDec), inDec)
      const minRaw = parseUnits(Math.max(q.minOut, 0).toFixed(outDec), outDec)
      const before = await this.bal(outAddr)
      await this.send(inAddr, side === 'buy' ? this.abis.usdc : this.abis.token, 'approve', [this.dep.swapRouter, raw])
      const hash = await this.send(this.dep.swapRouter, this.abis.router, 'swapExactIn', [key, this.zeroForOne(sym, side), raw, minRaw])
      const got = Number(formatUnits((await this.bal(outAddr)) - before, outDec))
      this.settle(sym, side, amount, got)
      return { ok: true, hash, quote: q, filledOut: got }
    })
  }

  async faucet(): Promise<TradeResult> {
    return this.guard(async () => {
      const hash = await this.send(this.dep.usdc, this.abis.usdc, 'faucet', [])
      return { ok: true, hash }
    })
  }

  async mint(sym: string, usdcIn: number): Promise<TradeResult> {
    return this.guard(async () => {
      const t = this.tk(sym)
      const raw = parseUnits(usdcIn.toFixed(USDC_DEC), USDC_DEC)
      const before = await this.bal(t.token)
      await this.send(this.dep.usdc, this.abis.usdc, 'approve', [this.dep.issuer, raw])
      const hash = await this.send(this.dep.issuer, this.abis.issuer, 'mint', [t.feedId, raw])
      const got = Number(formatUnits((await this.bal(t.token)) - before, TOKEN_DEC))
      this.settle(sym, 'buy', usdcIn, got)
      return { ok: true, hash, filledOut: got }
    })
  }

  async redeem(sym: string, tokensIn: number): Promise<TradeResult> {
    return this.guard(async () => {
      const t = this.tk(sym)
      const raw = parseUnits(tokensIn.toFixed(TOKEN_DEC), TOKEN_DEC)
      const before = await this.bal(this.dep.usdc)
      const hash = await this.send(this.dep.issuer, this.abis.issuer, 'redeem', [t.feedId, raw])
      const got = Number(formatUnits((await this.bal(this.dep.usdc)) - before, USDC_DEC))
      this.settle(sym, 'sell', tokensIn, got)
      return { ok: true, hash, filledOut: got }
    })
  }

  async addLiquidity(sym: string, pool: PoolKind, usd: number, range: RangePreset): Promise<TradeResult> {
    return this.guard(async () => {
      const t = this.tk(sym)
      const key = this.keyOf(t, pool)
      const snap = await this.snap(sym, pool)
      const sp = key.tickSpacing
      const w = RANGE_TICKS[range]
      const lower = Math.floor((snap.tick - w) / sp) * sp
      const upper = Math.ceil((snap.tick + w) / sp) * sp
      const stockCap = parseUnits((usd / 2 / snap.priceUsd).toFixed(TOKEN_DEC), TOKEN_DEC)
      const usdcCap = parseUnits((usd / 2).toFixed(USDC_DEC), USDC_DEC)
      const haveStock = await this.bal(t.token)
      if (haveStock < stockCap) {
        return { ok: false, error: `You need about ${(usd / 2 / snap.priceUsd).toFixed(4)} t${sym} for the stock half of the deposit. Mint some on the Mint & redeem page first.` }
      }
      const c0 = this.stockIsC0(sym)
      await this.send(this.dep.usdc, this.abis.usdc, 'approve', [this.dep.liquidityRouter, usdcCap])
      await this.send(t.token, this.abis.token, 'approve', [this.dep.liquidityRouter, stockCap])
      const hash = await this.send(this.dep.liquidityRouter, this.abis.lrouter, 'addLiquidityAmounts', [key, lower, upper, c0 ? stockCap : usdcCap, c0 ? usdcCap : stockCap])
      this.positions.push({ id: `${sym}-${pool}-${lower}-${upper}`, sym, pool, range, depositUsd: usd, tickLower: lower, tickUpper: upper, openedTs: Number(await this.chainNow()) })
      this.savePositions()
      return { ok: true, hash }
    })
  }

  async removeLiquidity(id: string): Promise<TradeResult> {
    return this.guard(async () => {
      const p = this.positions.find((x) => x.id === id)
      if (!p) return { ok: false, error: 'Position not found.' }
      const t = this.tk(p.sym)
      const key = this.keyOf(t, p.pool)
      const liq = (await this.read(this.dep.liquidityRouter, this.abis.lrouter, 'liquidityOf', [key, this.account.address, p.tickLower, p.tickUpper])) as bigint
      if (liq === 0n) {
        this.positions = this.positions.filter((x) => x.id !== id)
        this.savePositions()
        return { ok: false, error: 'That position has no liquidity left on chain; it was removed from the list.' }
      }
      const hash = await this.send(this.dep.liquidityRouter, this.abis.lrouter, 'removeLiquidity', [key, p.tickLower, p.tickUpper, liq])
      this.positions = this.positions.filter((x) => x.id !== id)
      this.savePositions()
      return { ok: true, hash }
    })
  }

  // ---------------------------------------------------------------- helpers
  private async guard(fn: () => Promise<TradeResult>): Promise<TradeResult> {
    try {
      const r = await fn()
      await this.refresh()
      return r
    } catch (e) {
      return { ok: false, error: this.errText(e) }
    }
  }

  private tk(sym: string): TickerDeploy {
    const t = this.dep.tickers[sym]
    if (!t) throw new Error('Unknown ticker ' + sym)
    return t
  }

  private keyOf(t: TickerDeploy, pool: PoolKind): PoolKeyJson {
    return (pool === 'hook' ? t.hookPool : t.controlPool).key
  }

  private baseFeeBps(t: TickerDeploy, pool: PoolKind): number {
    // the hook pool's key carries the dynamic-fee flag, so its base fee is the deployment's baseFeePips
    return pool === 'hook' ? (this.dep.baseFeePips ?? 3000) / 100 : this.keyOf(t, 'control').fee / 100
  }

  private savePositions(): void {
    try {
      localStorage.setItem(`dfee.pos.${this.account.address}`, JSON.stringify(this.positions))
    } catch {
      /* storage unavailable: positions simply do not persist */
    }
  }

  private saveBasis(): void {
    try {
      localStorage.setItem(`dfee.basis.${this.account.address}`, JSON.stringify(this.basis))
    } catch {
      /* storage unavailable */
    }
  }

  private settle(sym: string, side: Side, amountIn: number, out: number): void {
    const b = this.basis[sym] ?? { qty: 0, costUsd: 0, realizedUsd: 0 }
    if (side === 'buy') {
      b.qty += out
      b.costUsd += amountIn
    } else {
      const avg = b.qty > 0 ? b.costUsd / b.qty : 0
      b.realizedUsd += out - avg * amountIn
      b.costUsd -= avg * amountIn
      b.qty -= amountIn
    }
    this.basis[sym] = b
    this.saveBasis()
  }

  private errText(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e)
    const short = (m.split('\n')[0] ?? m).slice(0, 260)
    if (/PrimaryMarketClosed/.test(m)) return 'Primary market closed: the issuer only mints and redeems while the session is open and the oracle is fresh. The pools still trade.'
    if (/FaucetCooldown/.test(m)) return 'Faucet cooldown: you already claimed recently. Try again later.'
    if (/SlippageExceeded/.test(m)) return 'Slippage exceeded: the on-chain output was below your minimum. The quote is an estimate, so raise the slippage tolerance.'
    if (/ERC20InsufficientBalance/.test(m)) return 'Not enough balance for that amount.'
    return short
  }

  private async read(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<unknown> {
    return this.pub.readContract({ address, abi, functionName, args } as never)
  }

  private async send(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<string> {
    const { request } = await this.pub.simulateContract({ account: this.account, address, abi, functionName, args } as never)
    const hash = await this.wallet.writeContract(request as never)
    const rc = await this.pub.waitForTransactionReceipt({ hash })
    if (rc.status !== 'success') throw new Error('Transaction reverted: ' + hash)
    return hash
  }

  private async bal(token: Address): Promise<bigint> {
    const abi = token.toLowerCase() === this.dep.usdc.toLowerCase() ? this.abis.usdc : this.abis.token
    return (await this.read(token, abi, 'balanceOf', [this.account.address])) as bigint
  }

  private async chainNow(): Promise<bigint> {
    return (await this.pub.getBlock()).timestamp
  }

  private stockIsC0(sym: string): boolean {
    const t = this.tk(sym)
    return t.stockIsCurrency0 ?? t.token.toLowerCase() < this.dep.usdc.toLowerCase()
  }

  private zeroForOne(sym: string, side: Side): boolean {
    // buying the stock means paying USDC
    const c0 = this.stockIsC0(sym)
    return side === 'buy' ? !c0 : c0
  }

  private async slot(poolId: Hex, offset: bigint): Promise<bigint> {
    const r = (await this.read(this.dep.poolManager, this.abis.pm, 'extsload', [toHex32(poolSlot(poolId) + offset)])) as Hex
    return BigInt(r)
  }

  private async snap(sym: string, pool: PoolKind): Promise<PoolSnap> {
    const t = this.tk(sym)
    const poolId = (pool === 'hook' ? t.hookPool : t.controlPool).poolId
    const s0 = await this.slot(poolId, 0n)
    const liq = await this.slot(poolId, 3n)
    const sqrtX96 = s0 & ((1n << 160n) - 1n)
    let tick = Number((s0 >> 160n) & 0xffffffn)
    if (tick >= 1 << 23) tick -= 1 << 24
    const sqrtP = Number(sqrtX96) / 2 ** 96
    const raw = sqrtP * sqrtP // token1 raw per token0 raw
    const c0 = this.stockIsC0(sym)
    const f = 10 ** (TOKEN_DEC - USDC_DEC)
    const priceUsd = raw > 0 ? (c0 ? raw * f : f / raw) : 0
    const L = Number(liq & ((1n << 128n) - 1n))
    const x0 = sqrtP > 0 ? L / sqrtP : 0
    const y1 = L * sqrtP
    return {
      priceUsd,
      tick,
      sqrtP,
      liquidity: L,
      stockVirt: (c0 ? x0 : y1) / 10 ** TOKEN_DEC,
      usdcVirt: (c0 ? y1 : x0) / 10 ** USDC_DEC,
    }
  }

  /** constant-product estimate on the pool's virtual reserves at the current price. It ignores tick crossings, so large trades are approximate. */
  private estimate(v: PoolSnap, side: Side, amountIn: number, feeBps: number): number {
    const eff = amountIn * (1 - feeBps / 1e4)
    const x = v.stockVirt
    const y = v.usdcVirt
    if (!(x > 0 && y > 0)) return 0
    return side === 'buy' ? x - (x * y) / (y + eff) : y - (x * y) / (x + eff)
  }

  private async refPrice(sym: string): Promise<{ price: number; age: number; open: boolean }> {
    const t = this.tk(sym)
    const r = (await this.read(this.dep.oracle, this.abis.oracle, 'priceOf', [t.feedId])) as readonly [bigint, bigint, boolean]
    const now = await this.chainNow()
    return { price: Number(r[0]) / 1e8, age: Number(now - r[1]), open: r[2] }
  }

  private async feeFor(sym: string, pool: PoolKind, zeroForOne: boolean): Promise<[number, boolean, boolean, Reason]> {
    const t = this.tk(sym)
    const base = this.baseFeeBps(t, pool)
    if (pool === 'control') return [base, false, false, 'no-reference']
    const r = (await this.read(this.dep.hook, this.abis.hook, 'quoteFee', [t.hookPool.key, zeroForOne])) as readonly [number, bigint, boolean]
    const feeBps = Number(r[0]) / 100
    const armed = feeBps > base + 1e-9
    const reason: Reason = armed ? 'surcharge' : r[2] ? 'inside-deadband' : 'non-arbitrage-direction'
    return [feeBps, armed, r[2], reason]
  }

  private empty(): EngineState {
    return {
      mode: 'chain',
      issuerFeeBps: 0,
      sourceNote: 'ANVIL: reading the local deployment (chain 31337). Test tokens only.',
      markets: [],
      wallet: { address: this.account.address, usdc: 0, tokens: {}, basis: {} },
      events: [],
      positions: [],
      reserves: [],
      summary: null,
      sim: { playing: false, speed: 1, simTs: 0 },
    }
  }

  private hist = new HistoryBuf()

  history(sym: string): readonly HistorySample[] {
    return this.hist.get(sym)
  }

  private emit(): void {
    this.hist.record(this.state)
    for (const l of this.listeners) l()
  }

  private async refresh(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const markets: MarketRow[] = []
      const reserves: ReserveRow[] = []
      const tokens: Record<string, number> = {}
      const usdc = Number(formatUnits(await this.bal(this.dep.usdc), USDC_DEC))
      const now = await this.chainNow()
      for (const sym of this.syms) {
        const t = this.tk(sym)
        const ref = await this.refPrice(sym)
        const mk = async (kind: PoolKind): Promise<PoolView> => {
          const st = await this.snap(sym, kind)
          const [fb] = await this.feeFor(sym, kind, this.zeroForOne(sym, 'buy'))
          const [fs] = await this.feeFor(sym, kind, this.zeroForOne(sym, 'sell'))
          return {
            priceUsd: st.priceUsd,
            devBps: ref.price > 0 ? Math.abs(st.priceUsd / ref.price - 1) * 1e4 : 0,
            feeBuyBps: fb,
            feeSellBps: fs,
            baseFeeBps: this.baseFeeBps(t, kind),
            tvlUsd: st.stockVirt * st.priceUsd + st.usdcVirt,
          }
        }
        const hook = await mk('hook')
        const control = await mk('control')
        markets.push({ sym, name: TICKERS.find((x) => x.sym === sym)?.name ?? sym, refPriceUsd: ref.price, refAgeSec: ref.age, sessionOpen: ref.open, hook, control })
        tokens[sym] = Number(formatUnits(await this.bal(t.token), TOKEN_DEC))
        const por = (await this.read(this.dep.issuer, this.abis.issuer, 'proofOfReserve', [t.feedId])) as readonly [bigint, bigint, boolean]
        const supply = (await this.read(t.token, this.abis.token, 'totalSupply', [])) as bigint
        const resUsd = Number(formatUnits(por[0], USDC_DEC))
        const valUsd = Number(formatUnits(por[1], USDC_DEC))
        reserves.push({ sym, supply: Number(formatUnits(supply, TOKEN_DEC)), usdcReserve: resUsd, supplyValueUsd: valUsd, oraclePriceUsd: ref.price, backingRatio: valUsd > 0 ? resUsd / valUsd : 1, fullyBacked: por[2] })
        // holdings we have no cost basis for (acquired outside this UI) are valued at today's price, so their P&L starts at zero
        const b = this.basis[sym]
        const held = tokens[sym] ?? 0
        if (!b || Math.abs(b.qty - held) > 1e-6 * Math.max(1, held)) this.basis[sym] = { qty: held, costUsd: held * ref.price, realizedUsd: b?.realizedUsd ?? 0 }
      }
      await this.pollEvents()
      const summary = await this.loadSummary()
      const positions = await this.positionViews(markets)
      this.state = {
        ...this.state,
        issuerFeeBps: this.issuerFeeBps,
        markets,
        reserves,
        wallet: { address: this.account.address, usdc, tokens, basis: { ...this.basis } },
        positions,
        summary,
        events: this.events.slice(),
        sim: { playing: false, speed: 1, simTs: Number(now) },
        error: undefined,
      }
    } catch (e) {
      this.state = { ...this.state, error: this.errText(e) }
    }
    this.busy = false
    this.emit()
  }

  private async positionViews(markets: MarketRow[]): Promise<LpPosition[]> {
    const out: LpPosition[] = []
    for (const p of this.positions) {
      const t = this.dep.tickers[p.sym]
      const m = markets.find((x) => x.sym === p.sym)
      if (!t || !m) continue
      const liq = Number((await this.read(this.dep.liquidityRouter, this.abis.lrouter, 'liquidityOf', [this.keyOf(t, p.pool), this.account.address, p.tickLower, p.tickUpper])) as bigint)
      if (liq === 0) continue
      const snap = await this.snap(p.sym, p.pool)
      const sa = sqrtAtTick(p.tickLower)
      const sb = sqrtAtTick(p.tickUpper)
      const sp = Math.min(Math.max(snap.sqrtP, sa), sb)
      const a0 = liq * (1 / sp - 1 / sb) // token0 raw
      const a1 = liq * (sp - sa) // token1 raw
      const c0 = this.stockIsC0(p.sym)
      const stock = (c0 ? a0 : a1) / 10 ** TOKEN_DEC
      const cash = (c0 ? a1 : a0) / 10 ** USDC_DEC
      const value = stock * snap.priceUsd + cash
      out.push({ id: p.id, sym: p.sym, pool: p.pool, range: p.range, depositUsd: p.depositUsd, feesUsd: 0, valueUsd: value, vsHoldUsd: 0, inRange: snap.tick >= p.tickLower && snap.tick < p.tickUpper, openedTs: p.openedTs })
    }
    return out
  }

  private async tsOf(block: bigint): Promise<number> {
    const hit = this.blockTs.get(block)
    if (hit !== undefined) return hit
    const b = await this.pub.getBlock({ blockNumber: block })
    const ts = Number(b.timestamp)
    this.blockTs.set(block, ts)
    return ts
  }

  private async logs(address: Address, abi: Abi, name: string, from: bigint, to: bigint): Promise<RawLog[]> {
    const ev = getAbiItem({ abi, name }) as AbiEvent | undefined
    if (!ev) return []
    return (await this.pub.getLogs({ address, event: ev, fromBlock: from, toBlock: to })) as unknown as RawLog[]
  }

  private actorOf(addr: string): Actor {
    const a = addr.toLowerCase()
    if (a === this.account.address.toLowerCase()) return 'you'
    const acc = this.dep.accounts
    if (acc?.arb && a === acc.arb.toLowerCase()) return 'arb'
    if (acc?.retail && a === acc.retail.toLowerCase()) return 'retail'
    if (acc?.lps?.some((l) => l.toLowerCase() === a)) return 'lp'
    return 'system'
  }

  private async pollEvents(): Promise<void> {
    const head = await this.pub.getBlockNumber()
    const lookback = BigInt(Number(import.meta.env.VITE_FROM_BLOCKS ?? 5000))
    const from = this.lastBlock === 0n ? (head > lookback ? head - lookback : 0n) : this.lastBlock + 1n
    if (from > head) return
    const byPool = new Map<string, { sym: string; pool: PoolKind }>()
    for (const [sym, t] of Object.entries(this.dep.tickers)) {
      byPool.set(t.hookPool.poolId.toLowerCase(), { sym, pool: 'hook' })
      byPool.set(t.controlPool.poolId.toLowerCase(), { sym, pool: 'control' })
    }
    const out: (Omit<FlowEvent, 'id'> & { sort: number })[] = []
    const add = (e: Omit<FlowEvent, 'id'>, block: bigint, idx: number) => out.push({ ...e, sort: Number(block) * 1e5 + idx })

    const feeLogs = await this.logs(this.dep.hook, this.abis.hook, 'FeeSet', from, head)
    const feeByTx = new Map<string, RawLog[]>()
    for (const l of feeLogs) {
      const k = `${l.transactionHash}:${String(l.args.poolId).toLowerCase()}`
      feeByTx.set(k, [...(feeByTx.get(k) ?? []), l])
    }
    const routed = await this.logs(this.dep.swapRouter, this.abis.router, 'Routed', from, head)
    for (const l of routed) {
      const pid = String(l.args.poolId).toLowerCase()
      const meta = byPool.get(pid)
      const fl = feeByTx.get(`${l.transactionHash}:${pid}`)?.shift()
      const t = meta ? this.dep.tickers[meta.sym] : undefined
      const zfo = Boolean(l.args.zeroForOne)
      const c0 = meta ? this.stockIsC0(meta.sym) : true
      const amtIn = Number(l.args.amountIn as bigint)
      const amtOut = Number(l.args.amountOut as bigint)
      const size = zfo === c0 ? amtOut / 10 ** USDC_DEC : amtIn / 10 ** USDC_DEC
      const base = t && meta ? this.baseFeeBps(t, meta.pool) : 30
      const actor = this.actorOf(String(l.args.payer))
      add(
        {
          ts: await this.tsOf(l.blockNumber),
          kind: 'swap',
          sym: meta?.sym,
          pool: meta?.pool,
          actor,
          detail: `${actor === 'you' ? 'You' : actor === 'arb' ? 'Arbitrageur' : actor === 'retail' ? 'Retail' : 'Someone'} ${zfo === c0 ? 'sold' : 'bought'} t${meta?.sym ?? '?'} in the ${meta?.pool ?? '?'} pool`,
          sizeUsd: size,
          feeBps: fl ? Number(fl.args.fee) / 100 : base,
          baseFeeBps: base,
          armed: fl ? Number(fl.args.fee) / 100 > base + 1e-9 : false,
        },
        l.blockNumber,
        l.logIndex,
      )
    }
    const orLogs = await this.logs(this.dep.oracle, this.abis.oracle, 'FeedUpdated', from, head)
    for (const l of orLogs) {
      const sym = Object.entries(this.dep.tickers).find(([, t]) => t.feedId.toLowerCase() === String(l.args.feedId).toLowerCase())?.[0]
      add({ ts: await this.tsOf(l.blockNumber), kind: 'oracle', sym, actor: 'oracle', detail: `Oracle update ${sym ?? ''}: $${(Number(l.args.priceE8) / 1e8).toFixed(2)}${l.args.sessionOpen ? ' (session open)' : ' (session closed)'}` }, l.blockNumber, l.logIndex)
    }
    for (const name of ['Minted', 'Redeemed'] as const) {
      for (const l of await this.logs(this.dep.issuer, this.abis.issuer, name, from, head)) {
        const sym = Object.entries(this.dep.tickers).find(([, t]) => t.feedId.toLowerCase() === String(l.args.feedId).toLowerCase())?.[0]
        const usdcAmt = Number((name === 'Minted' ? l.args.usdcIn : l.args.usdcOut) as bigint) / 10 ** USDC_DEC
        const tokAmt = Number((name === 'Minted' ? l.args.tokensOut : l.args.tokensIn) as bigint) / 10 ** TOKEN_DEC
        add({ ts: await this.tsOf(l.blockNumber), kind: name === 'Minted' ? 'mint' : 'redeem', sym, actor: 'issuer', detail: `${name === 'Minted' ? 'Minted' : 'Redeemed'} ${tokAmt.toFixed(4)} t${sym ?? ''} for ${usdcAmt.toFixed(2)} tUSDC (${this.actorOf(String(l.args.user))}).`, sizeUsd: usdcAmt }, l.blockNumber, l.logIndex)
      }
    }
    for (const l of await this.logs(this.dep.liquidityRouter, this.abis.lrouter, 'LiquidityChanged', from, head)) {
      const meta = byPool.get(String(l.args.poolId).toLowerCase())
      const delta = l.args.liquidityDelta as bigint
      add({ ts: await this.tsOf(l.blockNumber), kind: 'lp', sym: meta?.sym, pool: meta?.pool, actor: this.actorOf(String(l.args.lp)), detail: `Liquidity ${delta >= 0n ? 'added to' : 'removed from'} the ${meta?.pool ?? '?'} pool, ticks ${String(l.args.tickLower)} to ${String(l.args.tickUpper)}.` }, l.blockNumber, l.logIndex)
    }
    out.sort((a, b) => a.sort - b.sort)
    for (const { sort: _sort, ...e } of out) this.events.push({ id: this.eventId++, ...e })
    if (this.events.length > 600) this.events.splice(0, this.events.length - 600)
    this.lastBlock = head
  }

  private async loadSummary(): Promise<SimSummary | null> {
    try {
      const r = await fetch('/sim/summary.json', { cache: 'no-store' })
      if (!r.ok) return null
      return normalizeSummary(await r.json())
    } catch {
      return null
    }
  }
}

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

function pick(o: Record<string, unknown>, ...names: string[]): number {
  for (const n of names) if (n in o) return num(o[n])
  return 0
}

function stats(o: unknown): PoolStats {
  const r = (o ?? {}) as Record<string, unknown>
  return {
    volumeUsd: pick(r, 'volume', 'volumeUsd'),
    feesUsd: pick(r, 'fees', 'feesUsd'),
    arbProfitUsd: pick(r, 'arbProfit', 'arbProfitUsd'),
    retailFeePaidUsd: pick(r, 'retailFeePaid', 'retailFeePaidUsd'),
    lpPnlUsd: pick(r, 'lpPnl', 'lpPnlUsd'),
    swapsSurchargedPct: pick(r, 'swapsSurchargedPct', 'swapsSurcharged%', 'swapsSurcharged'),
    retailSurchargedPct: pick(r, 'retailSurchargedPct', 'retailSurcharged%', 'retailSurcharged'),
    swaps: pick(r, 'swaps', 'n'),
  }
}

/** Accepts { perTicker | tickers: { NVDA: { hook, control } } } or { NVDA: { hook, control } }. Unknown shapes give null. */
export function normalizeSummary(j: unknown): SimSummary | null {
  if (typeof j !== 'object' || j === null) return null
  const root = j as Record<string, unknown>
  const pickRoot = (k: string) => (typeof root[k] === 'object' && root[k] !== null ? (root[k] as Record<string, unknown>) : null)
  const src = pickRoot('perTicker') ?? pickRoot('tickers') ?? root
  const out: SimSummary = { source: 'file', tickers: {} }
  for (const [sym, v] of Object.entries(src)) {
    if (typeof v !== 'object' || v === null) continue
    const o = v as Record<string, unknown>
    if (!('hook' in o) && !('control' in o)) continue
    out.tickers[sym] = { hook: stats(o.hook), control: stats(o.control) }
  }
  return Object.keys(out.tickers).length > 0 ? out : null
}

export type { PublicClient, WalletClient }
