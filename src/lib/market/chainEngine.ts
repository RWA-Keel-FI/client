import { encodeAbiParameters, formatEther, formatUnits, getAbiItem, keccak256, parseUnits } from 'viem'
import type { Abi, AbiEvent, Address, Hex, PublicClient, WalletClient } from 'viem'
import type { Reason } from '../types.ts'
import type { Abis, Deployment, PoolKeyJson, TickerDeploy } from '../chain/deployment.ts'
import { HistoryBuf } from './history.ts'
import type { HistorySample } from './history.ts'
import { TICKERS } from './types.ts'
import type {
  Actor,
  Engine,
  EngineState,
  FeeEventRow,
  FlowEvent,
  LpPosition,
  MarketRow,
  PoolKind,
  PoolView,
  Quote,
  RangePreset,
  ReserveRow,
  Side,
  TradeResult,
  TxStep,
} from './types.ts'

/**
 * Reads the Arc Testnet deployment through a viem public client and writes through the connected wallet (wagmi).
 * There is no private key anywhere in this file: every transaction is simulated here and then signed by the user's wallet.
 *
 * Pool state is read straight from the PoolManager's storage with `extsload` (the same slot math as the StateLibrary and
 * server/sim/src/anvilVenue.ts): Pool.State lives in mapping slot 6, slot0 at +0, liquidity at +3.
 */

interface Cfg {
  pub: PublicClient
  getWallet: () => Promise<WalletClient>
  dep: Deployment
  abis: Abis
}

const POOLS_SLOT = 6n
/** ticks for a +/- range around the current tick: ~40%, ~12%, ~3% (1.0001^ticks) */
const RANGE_TICKS: Record<RangePreset, number> = { wide: 3365, medium: 1133, tight: 296 }
const POLL_MS = Math.max(5000, Number(import.meta.env.VITE_POLL_MS ?? 6000))
const LOG_CHUNK = BigInt(Number(import.meta.env.VITE_LOG_CHUNK ?? 9000))
/** how far back the activity feed looks on first load, in blocks */
const LOOKBACK = BigInt(Number(import.meta.env.VITE_LOGS_LOOKBACK ?? 20000))
const MAX_EVENTS = 400

interface PoolSnap {
  priceUsd: number
  tick: number
  sqrtP: number
  stockVirt: number
  usdcVirt: number
}

interface Pt {
  sym: string
  kind: PoolKind
  t: TickerDeploy
  key: PoolKeyJson
  poolId: Hex
}

interface RangeRef {
  poolId: Hex
  tickLower: number
  tickUpper: number
}

interface LogLike {
  eventName: string
  args: Record<string, unknown>
  address: Address
  transactionHash: Hex
  blockNumber: bigint
  logIndex: number
}

function poolSlot(poolId: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, POOLS_SLOT])))
}

const toHex32 = (n: bigint): Hex => ('0x' + n.toString(16).padStart(64, '0')) as Hex
const sqrtAtTick = (tick: number) => Math.pow(1.0001, tick / 2)

export class ChainEngine implements Engine {
  syms: string[]
  usdcAddress: Address

  private pub: PublicClient
  private getWallet: () => Promise<WalletClient>
  private dep: Deployment
  private abis: Abis
  private account: Address | undefined
  private listeners = new Set<() => void>()
  private events: FlowEvent[] = []
  private feeEvents: FeeEventRow[] = []
  private eventId = 1
  private lastBlock = 0n
  private blockTs = new Map<bigint, number>()
  private timer: number | undefined
  private state: EngineState
  private busy = false
  private dead = false
  private issuerFeeBps = 0
  private usdcDec = 6
  private dec: Record<string, number> = {}
  private cfgBySym: Record<string, { maxAge: number; feeMax: number; f0: number }> = {}
  private pools: Pt[] = []
  private volume = new Map<string, number>() // poolId lower-case -> USD
  private ranges = new Map<string, RangeRef>()
  private rangesFrom = 0n
  private hist = new HistoryBuf()

  private constructor(c: Cfg) {
    this.pub = c.pub
    this.getWallet = c.getWallet
    this.dep = c.dep
    this.abis = c.abis
    this.usdcAddress = c.dep.usdc
    this.syms = TICKERS.map((t) => t.sym).filter((s) => c.dep.tickers[s])
    // tickers in the deployment that the UI has no display name for still show up
    for (const s of Object.keys(c.dep.tickers)) if (!this.syms.includes(s)) this.syms.push(s)
    for (const sym of this.syms) {
      const t = c.dep.tickers[sym]!
      this.pools.push({ sym, kind: 'hook', t, key: t.hookPool.key, poolId: t.hookPool.poolId })
      if (t.controlPool) this.pools.push({ sym, kind: 'control', t, key: t.controlPool.key, poolId: t.controlPool.poolId })
    }
    this.state = this.empty()
  }

  static async create(c: Cfg): Promise<ChainEngine> {
    const e = new ChainEngine(c)
    const cid = await e.pub.getChainId()
    if (cid !== c.dep.chainId) throw new Error(`The RPC is on chain ${cid}, the deployment is for chain ${c.dep.chainId}.`)
    // decimals are read from the contracts: USDC's ERC-20 interface is 6, the stock tokens are 18
    e.usdcDec = Number(await e.read(c.dep.usdc, c.abis.erc20, 'decimals', []))
    await Promise.all(
      e.syms.map(async (sym) => {
        const t = c.dep.tickers[sym]!
        e.dec[sym] = Number(await e.read(t.token, c.abis.erc20, 'decimals', []))
        const pc = (await e.read(c.dep.hook, c.abis.hook, 'poolConfig', [t.hookPool.poolId])) as { f0: number; feeMax: number; maxAge: number }
        e.cfgBySym[sym] = { f0: Number(pc.f0), feeMax: Number(pc.feeMax), maxAge: Number(pc.maxAge) }
      }),
    )
    e.issuerFeeBps = Number(await e.read(c.dep.issuer, c.abis.issuer, 'FEE_BPS', []))
    await e.refresh()
    e.timer = window.setInterval(() => void e.refresh(), POLL_MS)
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
    this.dead = true
    window.clearInterval(this.timer)
    this.listeners.clear()
  }
  tokenAddress(sym: string): Address | undefined {
    return this.dep.tickers[sym]?.token
  }
  history(sym: string): readonly HistorySample[] {
    return this.hist.get(sym)
  }

  setAccount(address: Address | undefined): void {
    if ((address ?? '').toLowerCase() === (this.account ?? '').toLowerCase()) return
    this.account = address
    this.ranges.clear()
    this.rangesFrom = 0n
    this.state = { ...this.state, wallet: { address: address ?? '', usdc: 0, native: 0, tokens: {} }, positions: [] }
    this.emit()
    void this.refresh()
  }

  async quote(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number): Promise<Quote> {
    const t = this.tk(sym)
    const p = this.pt(sym, pool)
    const other = this.pools.find((x) => x.sym === sym && x.kind !== pool)
    const zfo = this.zeroForOne(sym, side)
    const ref = await this.refPrice(sym)
    const [snap, f, otherSnap, oFee] = await Promise.all([
      this.snap(p),
      this.feeFor(sym, pool, zfo, ref),
      other ? this.snap(other) : Promise.resolve(null),
      other ? this.feeFor(sym, other.kind, zfo, ref) : Promise.resolve(null),
    ])
    let out = this.estimate(snap, side, amount, f.feeBps)
    const oOut = otherSnap && oFee ? this.estimate(otherSnap, side, amount, oFee.feeBps) : null
    let exact = false
    const sim = await this.simulateOut(sym, pool, side, amount)
    if (sim !== null) {
      out = sim
      exact = true
    }
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
      feeBps: f.feeBps,
      baseFeeBps: this.baseFeeBps(t, sym, pool),
      feeUsd: side === 'buy' ? amount * (f.feeBps / 1e4) : amount * mid * (f.feeBps / 1e4),
      armed: f.armed,
      reason: f.reason,
      towardRef: f.toward,
      devBps: ref.price > 0 ? Math.abs(mid / ref.price - 1) * 1e4 : 0,
      refPriceUsd: ref.price,
      otherPoolOut: oOut,
      otherPoolFeeBps: oFee ? oFee.feeBps : null,
      minOut: out * (1 - slippagePct / 100),
      exact,
    }
  }

  async trade(sym: string, pool: PoolKind, side: Side, amount: number, slippagePct: number, minOut?: number, onStep?: (s: TxStep) => void): Promise<TradeResult> {
    return this.guard(async () => {
      this.needAccount()
      const q = await this.quote(sym, pool, side, amount, slippagePct)
      if (minOut !== undefined && q.amountOut < minOut) return { ok: false, quote: q, error: 'The price moved since the preview. Review the new quote and try again.' }
      const t = this.tk(sym)
      const key = this.pt(sym, pool).key
      const inAddr = side === 'buy' ? this.dep.usdc : t.token
      const inDec = side === 'buy' ? this.usdcDec : this.dec[sym]!
      const outAddr = side === 'buy' ? t.token : this.dep.usdc
      const outDec = side === 'buy' ? this.dec[sym]! : this.usdcDec
      const raw = parseUnits(amount.toFixed(inDec), inDec)
      const minRaw = parseUnits(Math.max(q.minOut, 0).toFixed(outDec), outDec)
      const before = await this.bal(outAddr)
      const approveHash = await this.ensureAllowance(inAddr, this.dep.swapRouter, raw, onStep)
      const hash = await this.send(this.dep.swapRouter, this.abis.router, 'swapExactIn', [key, this.zeroForOne(sym, side), raw, minRaw], onStep)
      const got = Number(formatUnits((await this.bal(outAddr)) - before, outDec))
      return { ok: true, hash, approveHash, quote: q, filledOut: got }
    })
  }

  async mint(sym: string, usdcIn: number, onStep?: (s: TxStep) => void): Promise<TradeResult> {
    return this.guard(async () => {
      this.needAccount()
      const t = this.tk(sym)
      const raw = parseUnits(usdcIn.toFixed(this.usdcDec), this.usdcDec)
      const before = await this.bal(t.token)
      const approveHash = await this.ensureAllowance(this.dep.usdc, this.dep.issuer, raw, onStep)
      const hash = await this.send(this.dep.issuer, this.abis.issuer, 'mint', [t.feedId, raw], onStep)
      const got = Number(formatUnits((await this.bal(t.token)) - before, this.dec[sym]!))
      return { ok: true, hash, approveHash, filledOut: got }
    })
  }

  async redeem(sym: string, tokensIn: number, onStep?: (s: TxStep) => void): Promise<TradeResult> {
    return this.guard(async () => {
      this.needAccount()
      const t = this.tk(sym)
      const raw = parseUnits(tokensIn.toFixed(this.dec[sym]!), this.dec[sym]!)
      const before = await this.bal(this.dep.usdc)
      const hash = await this.send(this.dep.issuer, this.abis.issuer, 'redeem', [t.feedId, raw], onStep)
      const got = Number(formatUnits((await this.bal(this.dep.usdc)) - before, this.usdcDec))
      return { ok: true, hash, filledOut: got }
    })
  }

  async addLiquidity(sym: string, pool: PoolKind, usd: number, range: RangePreset, onStep?: (s: TxStep) => void): Promise<TradeResult> {
    return this.guard(async () => {
      this.needAccount()
      const t = this.tk(sym)
      const p = this.pt(sym, pool)
      const snap = await this.snap(p)
      const sp = p.key.tickSpacing
      const w = RANGE_TICKS[range]
      const lower = Math.floor((snap.tick - w) / sp) * sp
      const upper = Math.ceil((snap.tick + w) / sp) * sp
      const stockDec = this.dec[sym]!
      const stockCap = parseUnits((usd / 2 / snap.priceUsd).toFixed(stockDec), stockDec)
      const usdcCap = parseUnits((usd / 2).toFixed(this.usdcDec), this.usdcDec)
      const haveStock = await this.bal(t.token)
      if (haveStock < stockCap) {
        return { ok: false, error: `You need about ${(usd / 2 / snap.priceUsd).toFixed(4)} t${sym} for the stock half of the deposit. Mint some on the Mint & redeem page first.` }
      }
      const c0 = this.stockIsC0(sym)
      const a1 = await this.ensureAllowance(this.dep.usdc, this.dep.liquidityRouter, usdcCap, onStep)
      const a2 = await this.ensureAllowance(t.token, this.dep.liquidityRouter, stockCap, onStep)
      const hash = await this.send(this.dep.liquidityRouter, this.abis.lrouter, 'addLiquidityAmounts', [p.key, lower, upper, c0 ? stockCap : usdcCap, c0 ? usdcCap : stockCap], onStep)
      this.ranges.set(`${p.poolId}:${lower}:${upper}`, { poolId: p.poolId, tickLower: lower, tickUpper: upper })
      return { ok: true, hash, approveHash: a2 ?? a1 }
    })
  }

  async removeLiquidity(id: string, onStep?: (s: TxStep) => void): Promise<TradeResult> {
    return this.guard(async () => {
      const acct = this.needAccount()
      const r = this.ranges.get(id)
      const p = r && this.pools.find((x) => x.poolId.toLowerCase() === r.poolId.toLowerCase())
      if (!r || !p) return { ok: false, error: 'Position not found.' }
      const liq = (await this.read(this.dep.liquidityRouter, this.abis.lrouter, 'liquidityOf', [p.key, acct, r.tickLower, r.tickUpper])) as bigint
      if (liq === 0n) return { ok: false, error: 'That position has no liquidity left on chain.' }
      const hash = await this.send(this.dep.liquidityRouter, this.abis.lrouter, 'removeLiquidity', [p.key, r.tickLower, r.tickUpper, liq], onStep)
      return { ok: true, hash }
    })
  }

  // ---------------------------------------------------------------- helpers
  private needAccount(): Address {
    if (!this.account) throw new Error('Connect a wallet first.')
    return this.account
  }

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

  private pt(sym: string, kind: PoolKind): Pt {
    const p = this.pools.find((x) => x.sym === sym && x.kind === kind)
    if (!p) throw new Error(`${sym} has no ${kind} pool in this deployment`)
    return p
  }

  private baseFeeBps(t: TickerDeploy, sym: string, pool: PoolKind): number {
    if (pool === 'hook') return (this.cfgBySym[sym]?.f0 ?? this.dep.baseFeePips ?? 3000) / 100
    return (t.controlPool?.key.fee ?? 3000) / 100
  }

  private errText(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e)
    const short = (m.split('\n')[0] ?? m).slice(0, 260)
    if (/User rejected|User denied|rejected the request|ACTION_REJECTED/i.test(m)) return 'You rejected the request in your wallet.'
    if (/PrimaryMarketClosed/.test(m)) return 'Primary market closed: the issuer only mints and redeems while the session is open and the oracle is fresh. The pools still trade.'
    if (/SlippageExceeded/.test(m)) return 'Slippage exceeded: the on-chain output was below your minimum. Raise the slippage tolerance or trade a smaller size.'
    if (/ERC20InsufficientBalance|transfer amount exceeds balance/i.test(m)) return 'Not enough balance for that amount.'
    if (/ERC20InsufficientAllowance|insufficient allowance/i.test(m)) return 'Allowance too low. Approve the token again.'
    if (/insufficient funds|exceeds the balance of the account/i.test(m)) return 'Not enough USDC to pay the network fee (Arc uses USDC for gas).'
    if (/chain.*mismatch|does not match the target chain/i.test(m)) return 'Your wallet is on a different network. Switch to Arc Testnet.'
    if (/rate limit|429/i.test(m)) return 'The RPC is rate limiting requests. Wait a few seconds and try again.'
    return short
  }

  private async read(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<unknown> {
    return this.pub.readContract({ address, abi, functionName, args } as never)
  }

  private async bal(token: Address): Promise<bigint> {
    return (await this.read(token, this.abis.erc20, 'balanceOf', [this.needAccount()])) as bigint
  }

  /** Approves exactly `amount` when the current allowance is lower. Returns the approval tx hash if one was sent. */
  private async ensureAllowance(token: Address, spender: Address, amount: bigint, onStep?: (s: TxStep) => void): Promise<string | undefined> {
    const have = (await this.read(token, this.abis.erc20, 'allowance', [this.needAccount(), spender])) as bigint
    if (have >= amount) return undefined
    return this.send(token, this.abis.erc20, 'approve', [spender, amount], onStep, true)
  }

  /** simulate (so reverts show a readable reason before the wallet opens), sign in the wallet, wait for the receipt */
  private async send(address: Address, abi: Abi, functionName: string, args: readonly unknown[], onStep?: (s: TxStep) => void, isApprove = false): Promise<string> {
    const account = this.needAccount()
    const { request } = await this.pub.simulateContract({ account, address, abi, functionName, args } as never)
    onStep?.({ phase: isApprove ? 'approve-sign' : 'sign' })
    const wallet = await this.getWallet()
    if (wallet.account?.address.toLowerCase() !== account.toLowerCase()) throw new Error('The connected wallet account changed. Reconnect and try again.')
    const hash = await wallet.writeContract(request as never)
    onStep?.({ phase: isApprove ? 'approve-pending' : 'pending', hash })
    const rc = await this.pub.waitForTransactionReceipt({ hash })
    if (rc.status !== 'success') throw new Error('Transaction reverted: ' + hash)
    return hash
  }

  /** Exact output of the swap, by simulating it from the user's account. Null when the account cannot pay yet (no balance or allowance). */
  private async simulateOut(sym: string, pool: PoolKind, side: Side, amount: number): Promise<number | null> {
    if (!this.account || !(amount > 0)) return null
    try {
      const t = this.tk(sym)
      const inAddr = side === 'buy' ? this.dep.usdc : t.token
      const inDec = side === 'buy' ? this.usdcDec : this.dec[sym]!
      const outDec = side === 'buy' ? this.dec[sym]! : this.usdcDec
      const raw = parseUnits(amount.toFixed(inDec), inDec)
      const [have, allow] = await Promise.all([
        this.read(inAddr, this.abis.erc20, 'balanceOf', [this.account]) as Promise<bigint>,
        this.read(inAddr, this.abis.erc20, 'allowance', [this.account, this.dep.swapRouter]) as Promise<bigint>,
      ])
      if (have < raw || allow < raw) return null
      const { result } = await this.pub.simulateContract({
        account: this.account,
        address: this.dep.swapRouter,
        abi: this.abis.router,
        functionName: 'swapExactIn',
        args: [this.pt(sym, pool).key, this.zeroForOne(sym, side), raw, 0n],
      } as never)
      return Number(formatUnits(result as bigint, outDec))
    } catch {
      return null
    }
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

  private parseSnap(sym: string, words: readonly Hex[]): PoolSnap {
    const s0 = BigInt(words[0]!)
    const liq = BigInt(words[3]!)
    const sqrtX96 = s0 & ((1n << 160n) - 1n)
    let tick = Number((s0 >> 160n) & 0xffffffn)
    if (tick >= 1 << 23) tick -= 1 << 24
    const sqrtP = Number(sqrtX96) / 2 ** 96
    const raw = sqrtP * sqrtP // token1 raw per token0 raw
    const c0 = this.stockIsC0(sym)
    const f = 10 ** (this.dec[sym]! - this.usdcDec)
    const priceUsd = raw > 0 ? (c0 ? raw * f : f / raw) : 0
    const L = Number(liq & ((1n << 128n) - 1n))
    const x0 = sqrtP > 0 ? L / sqrtP : 0
    const y1 = L * sqrtP
    return {
      priceUsd,
      tick,
      sqrtP,
      stockVirt: (c0 ? x0 : y1) / 10 ** this.dec[sym]!,
      usdcVirt: (c0 ? y1 : x0) / 10 ** this.usdcDec,
    }
  }

  /** slot0 and liquidity in one call: extsload(startSlot, 4) returns slots +0..+3 of the pool's storage */
  private async snap(p: Pt): Promise<PoolSnap> {
    const words = (await this.read(this.dep.poolManager, this.abis.pm, 'extsload', [toHex32(poolSlot(p.poolId)), 4n])) as readonly Hex[]
    return this.parseSnap(p.sym, words)
  }

  /** constant-product estimate on the pool's virtual reserves at the current price. It ignores tick crossings, so large trades are approximate. */
  private estimate(v: PoolSnap, side: Side, amountIn: number, feeBps: number): number {
    const eff = amountIn * (1 - feeBps / 1e4)
    const x = v.stockVirt
    const y = v.usdcVirt
    if (!(x > 0 && y > 0)) return 0
    return side === 'buy' ? x - (x * y) / (y + eff) : y - (x * y) / (x + eff)
  }

  private async chainNow(): Promise<number> {
    return Number((await this.pub.getBlock()).timestamp)
  }

  private async refPrice(sym: string, now?: number): Promise<{ price: number; age: number; open: boolean; asOf: number }> {
    const t = this.tk(sym)
    const [r, ts] = await Promise.all([this.read(this.dep.oracle, this.abis.oracle, 'priceOf', [t.feedId]) as Promise<readonly [bigint, bigint, boolean]>, now ?? this.chainNow()])
    const asOf = Number(r[1])
    return { price: Number(r[0]) / 1e8, age: Math.max(0, ts - asOf), open: r[2], asOf }
  }

  private async feeFor(
    sym: string,
    pool: PoolKind,
    zeroForOne: boolean,
    ref: { price: number; age: number; open: boolean },
  ): Promise<{ feeBps: number; armed: boolean; toward: boolean; reason: Reason }> {
    const t = this.tk(sym)
    const base = this.baseFeeBps(t, sym, pool)
    if (pool === 'control') return { feeBps: base, armed: false, toward: false, reason: 'no-reference' }
    const r = (await this.read(this.dep.hook, this.abis.hook, 'quoteFee', [t.hookPool.key, zeroForOne])) as readonly [number, bigint, boolean]
    const feeBps = Number(r[0]) / 100
    const armed = feeBps > base + 1e-9
    let reason: Reason
    if (armed) reason = 'surcharge'
    else if (!(ref.price > 0)) reason = 'no-reference'
    else if (!ref.open) reason = 'session-closed'
    else if (ref.age > (this.cfgBySym[sym]?.maxAge ?? 900)) reason = 'stale-reference'
    else reason = r[2] ? 'inside-deadband' : 'non-arbitrage-direction'
    return { feeBps, armed, toward: r[2], reason }
  }

  private empty(): EngineState {
    return {
      ready: false,
      issuerFeeBps: 0,
      markets: [],
      wallet: { address: '', usdc: 0, native: 0, tokens: {} },
      events: [],
      feeEvents: [],
      positions: [],
      reserves: [],
      chainTs: 0,
      blockNumber: 0,
    }
  }

  private emit(): void {
    if (this.dead) return
    this.hist.record(this.state)
    for (const l of this.listeners) l()
  }

  async refresh(): Promise<void> {
    if (this.busy || this.dead) return
    this.busy = true
    const acct = this.account
    try {
      const block = await this.pub.getBlock()
      const now = Number(block.timestamp)
      // every read below is issued in the same tick, so viem folds them into multicalls and one HTTP batch
      const perSym = await Promise.all(
        this.syms.map(async (sym) => {
          const t = this.tk(sym)
          const hp = this.pt(sym, 'hook')
          const cp = this.pools.find((x) => x.sym === sym && x.kind === 'control')
          const [ref, hookSnap, ctlSnap, fb, fs, por, supply, bal, primaryOpen] = await Promise.all([
            this.refPrice(sym, now),
            this.snap(hp),
            cp ? this.snap(cp) : Promise.resolve(null),
            this.feeFor(sym, 'hook', this.zeroForOne(sym, 'buy'), { price: 0, age: 0, open: true }),
            this.feeFor(sym, 'hook', this.zeroForOne(sym, 'sell'), { price: 0, age: 0, open: true }),
            this.read(this.dep.issuer, this.abis.issuer, 'proofOfReserve', [t.feedId]) as Promise<readonly [bigint, bigint, boolean]>,
            this.read(t.token, this.abis.erc20, 'totalSupply', []) as Promise<bigint>,
            acct ? (this.read(t.token, this.abis.erc20, 'balanceOf', [acct]) as Promise<bigint>) : Promise.resolve(0n),
            this.read(this.dep.issuer, this.abis.issuer, 'primaryMarketOpen', [t.feedId]) as Promise<boolean>,
          ])
          return { sym, t, ref, hookSnap, ctlSnap, fb, fs, por, supply, bal, cp, primaryOpen }
        }),
      )
      const [usdcBal, nativeBal] = acct
        ? await Promise.all([this.read(this.dep.usdc, this.abis.erc20, 'balanceOf', [acct]) as Promise<bigint>, this.pub.getBalance({ address: acct })])
        : [0n, 0n]

      const markets: MarketRow[] = []
      const reserves: ReserveRow[] = []
      const tokens: Record<string, number> = {}
      for (const r of perSym) {
        const view = (snap: PoolSnap, kind: PoolKind, poolId: Hex, buy: number, sell: number): PoolView => ({
          priceUsd: snap.priceUsd,
          devBps: r.ref.price > 0 ? Math.abs(snap.priceUsd / r.ref.price - 1) * 1e4 : 0,
          feeBuyBps: buy,
          feeSellBps: sell,
          baseFeeBps: this.baseFeeBps(r.t, r.sym, kind),
          tvlUsd: snap.stockVirt * snap.priceUsd + snap.usdcVirt,
          volumeUsd: this.volume.get(poolId.toLowerCase()) ?? 0,
        })
        const cfg = this.cfgBySym[r.sym]!
        const ctlBase = this.baseFeeBps(r.t, r.sym, 'control')
        markets.push({
          sym: r.sym,
          name: TICKERS.find((x) => x.sym === r.sym)?.name ?? r.sym,
          refPriceUsd: r.ref.price,
          refAgeSec: r.ref.age,
          sessionOpen: r.ref.open,
          maxAgeSec: cfg.maxAge,
          primaryOpen: r.primaryOpen,
          stale: r.ref.age > cfg.maxAge,
          feeMaxBps: cfg.feeMax / 100,
          hook: view(r.hookSnap, 'hook', r.t.hookPool.poolId, r.fb.feeBps, r.fs.feeBps),
          control: r.ctlSnap && r.t.controlPool ? view(r.ctlSnap, 'control', r.t.controlPool.poolId, ctlBase, ctlBase) : null,
        })
        tokens[r.sym] = Number(formatUnits(r.bal, this.dec[r.sym]!))
        const resUsd = Number(formatUnits(r.por[0], this.usdcDec))
        const valUsd = Number(formatUnits(r.por[1], this.usdcDec))
        reserves.push({
          sym: r.sym,
          supply: Number(formatUnits(r.supply, this.dec[r.sym]!)),
          usdcReserve: resUsd,
          supplyValueUsd: valUsd,
          oraclePriceUsd: r.ref.price,
          backingRatio: valUsd > 0 ? resUsd / valUsd : 1,
          fullyBacked: r.por[2],
        })
      }

      let evError: string | undefined
      try {
        await this.pollEvents(block.number ?? 0n, acct)
      } catch (e) {
        evError = 'Activity feed: ' + this.errText(e)
      }
      const positions = acct ? await this.positionViews(acct, perSym, block.number ?? 0n) : []
      if (acct !== this.account) {
        this.busy = false
        return
      }
      this.state = {
        ready: true,
        issuerFeeBps: this.issuerFeeBps,
        markets,
        reserves,
        wallet: { address: acct ?? '', usdc: Number(formatUnits(usdcBal, this.usdcDec)), native: Number(formatEther(nativeBal)), tokens },
        positions,
        events: this.events.slice(),
        feeEvents: this.feeEvents.slice(),
        chainTs: now,
        blockNumber: Number(block.number ?? 0n),
        error: evError,
      }
    } catch (e) {
      this.state = { ...this.state, error: this.errText(e) }
    }
    this.busy = false
    this.emit()
  }

  // ---------------------------------------------------------------- LP positions
  /** Finds the ranges this account has ever touched (LiquidityChanged filtered by the indexed lp), then reads each one's live liquidity. */
  private async scanRanges(acct: Address, head: bigint): Promise<void> {
    const ev = getAbiItem({ abi: this.abis.lrouter, name: 'LiquidityChanged' }) as AbiEvent
    const floor = BigInt(this.dep.startBlock ?? 0)
    const back = LOOKBACK * 5n
    if (this.rangesFrom === 0n) this.rangesFrom = floor > 0n || head < back ? floor : head - back
    for (let from = this.rangesFrom; from <= head; from += LOG_CHUNK + 1n) {
      const to = from + LOG_CHUNK > head ? head : from + LOG_CHUNK
      const logs = (await this.pub.getLogs({ address: this.dep.liquidityRouter, event: ev, args: { lp: acct }, fromBlock: from, toBlock: to } as never)) as unknown as LogLike[]
      for (const l of logs) {
        const poolId = String(l.args.poolId) as Hex
        const lo = Number(l.args.tickLower)
        const hi = Number(l.args.tickUpper)
        this.ranges.set(`${poolId}:${lo}:${hi}`, { poolId, tickLower: lo, tickUpper: hi })
      }
    }
    this.rangesFrom = head + 1n
  }

  private async positionViews(acct: Address, perSym: { sym: string; hookSnap: PoolSnap; ctlSnap: PoolSnap | null }[], head: bigint): Promise<LpPosition[]> {
    try {
      await this.scanRanges(acct, head)
    } catch {
      /* keep the ranges already known; the next poll retries */
    }
    const jobs = [...this.ranges.entries()].map(async ([id, r]) => {
      const p = this.pools.find((x) => x.poolId.toLowerCase() === r.poolId.toLowerCase())
      if (!p) return null
      const liq = (await this.read(this.dep.liquidityRouter, this.abis.lrouter, 'liquidityOf', [p.key, acct, r.tickLower, r.tickUpper])) as bigint
      if (liq === 0n) return null
      const row = perSym.find((x) => x.sym === p.sym)
      const snap = p.kind === 'hook' ? row?.hookSnap : row?.ctlSnap
      if (!snap) return null
      const L = Number(liq)
      const sa = sqrtAtTick(r.tickLower)
      const sb = sqrtAtTick(r.tickUpper)
      const sp = Math.min(Math.max(snap.sqrtP, sa), sb)
      const a0 = L * (1 / sp - 1 / sb) // token0 raw
      const a1 = L * (sp - sa) // token1 raw
      const c0 = this.stockIsC0(p.sym)
      const stock = (c0 ? a0 : a1) / 10 ** this.dec[p.sym]!
      const cash = (c0 ? a1 : a0) / 10 ** this.usdcDec
      const f = 10 ** (this.dec[p.sym]! - this.usdcDec)
      const priceAt = (tick: number) => (c0 ? Math.pow(1.0001, tick) * f : f / Math.pow(1.0001, tick))
      const [pa, pb] = [priceAt(r.tickLower), priceAt(r.tickUpper)]
      const pos: LpPosition = {
        id,
        sym: p.sym,
        pool: p.kind,
        tickLower: r.tickLower,
        tickUpper: r.tickUpper,
        lowerUsd: Math.min(pa, pb),
        upperUsd: Math.max(pa, pb),
        liquidity: liq.toString(),
        stock,
        usdc: cash,
        valueUsd: stock * snap.priceUsd + cash,
        inRange: snap.tick >= r.tickLower && snap.tick < r.tickUpper,
      }
      return pos
    })
    return (await Promise.all(jobs)).filter((x): x is LpPosition => x !== null)
  }

  // ---------------------------------------------------------------- activity feed (real events)
  private async tsOf(block: bigint): Promise<number> {
    const hit = this.blockTs.get(block)
    if (hit !== undefined) return hit
    const b = await this.pub.getBlock({ blockNumber: block })
    const ts = Number(b.timestamp)
    this.blockTs.set(block, ts)
    return ts
  }

  private actorOf(addr: string): Actor {
    return this.account && addr.toLowerCase() === this.account.toLowerCase() ? 'you' : 'other'
  }

  private async pollEvents(head: bigint, acct: Address | undefined): Promise<void> {
    if (head === 0n) return
    const floor = BigInt(this.dep.startBlock ?? 0)
    const first = head > LOOKBACK ? head - LOOKBACK : 0n
    const from = this.lastBlock === 0n ? (first > floor ? first : floor) : this.lastBlock + 1n
    if (from > head) return
    const abis = this.abis
    const items: AbiEvent[] = [
      getAbiItem({ abi: abis.hook, name: 'FeeSet' }),
      getAbiItem({ abi: abis.router, name: 'Routed' }),
      getAbiItem({ abi: abis.oracle, name: 'FeedUpdated' }),
      getAbiItem({ abi: abis.issuer, name: 'Minted' }),
      getAbiItem({ abi: abis.issuer, name: 'Redeemed' }),
      getAbiItem({ abi: abis.lrouter, name: 'LiquidityChanged' }),
    ] as AbiEvent[]
    const address = [this.dep.hook, this.dep.swapRouter, this.dep.oracle, this.dep.issuer, this.dep.liquidityRouter]
    const logs: LogLike[] = []
    for (let a = from; a <= head; a += LOG_CHUNK + 1n) {
      const b = a + LOG_CHUNK > head ? head : a + LOG_CHUNK
      logs.push(...((await this.pub.getLogs({ address, events: items, fromBlock: a, toBlock: b } as never)) as unknown as LogLike[]))
    }
    logs.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1))

    const byPool = new Map<string, Pt>()
    for (const p of this.pools) byPool.set(p.poolId.toLowerCase(), p)
    const symOfFeed = (feedId: unknown) => Object.entries(this.dep.tickers).find(([, t]) => t.feedId.toLowerCase() === String(feedId).toLowerCase())?.[0]
    const feeByTx = new Map<string, LogLike[]>()
    for (const l of logs) {
      if (l.eventName !== 'FeeSet') continue
      const k = `${l.transactionHash}:${String(l.args.poolId).toLowerCase()}`
      feeByTx.set(k, [...(feeByTx.get(k) ?? []), l])
    }
    const out: Omit<FlowEvent, 'id'>[] = []
    const feeRows: FeeEventRow[] = []
    const newBlocks = new Set<bigint>()
    for (const l of logs) newBlocks.add(l.blockNumber)
    // timestamps only for the blocks that carry events; one batched HTTP request
    await Promise.all([...newBlocks].slice(-MAX_EVENTS).map((b) => this.tsOf(b)))
    const ts = (b: bigint) => this.blockTs.get(b) ?? 0

    for (const l of logs) {
      const base = { ts: ts(l.blockNumber), block: Number(l.blockNumber), tx: l.transactionHash }
      if (l.eventName === 'FeeSet') {
        const p = byPool.get(String(l.args.poolId).toLowerCase())
        if (!p) continue
        feeRows.push({ ...base, sym: p.sym, feeBps: Number(l.args.fee) / 100, baseFeeBps: Number(l.args.f0) / 100, netDevBps: Number(l.args.deviationBps), armed: Boolean(l.args.armed), id: `${l.transactionHash}-${l.logIndex}` })
      } else if (l.eventName === 'Routed') {
        const p = byPool.get(String(l.args.poolId).toLowerCase())
        const zfo = Boolean(l.args.zeroForOne)
        const c0 = p ? this.stockIsC0(p.sym) : true
        const sellsStock = zfo === c0
        const usdAmt = Number(sellsStock ? (l.args.amountOut as bigint) : (l.args.amountIn as bigint)) / 10 ** this.usdcDec
        if (p) this.volume.set(p.poolId.toLowerCase(), (this.volume.get(p.poolId.toLowerCase()) ?? 0) + usdAmt)
        const fl = p ? feeByTx.get(`${l.transactionHash}:${p.poolId.toLowerCase()}`)?.shift() : undefined
        const baseFee = p ? this.baseFeeBps(p.t, p.sym, p.kind) : 30
        const actor = this.actorOf(String(l.args.payer))
        out.push({
          ...base,
          kind: 'swap',
          sym: p?.sym,
          pool: p?.kind,
          actor,
          detail: `${actor === 'you' ? 'You' : shortAddr(String(l.args.payer))} ${sellsStock ? 'sold' : 'bought'} t${p?.sym ?? '?'} in the ${p?.kind ?? '?'} pool`,
          sizeUsd: usdAmt,
          feeBps: fl ? Number(fl.args.fee) / 100 : p?.kind === 'control' ? baseFee : undefined,
          baseFeeBps: baseFee,
          armed: fl ? Number(fl.args.fee) / 100 > baseFee + 1e-9 : false,
        })
      } else if (l.eventName === 'FeedUpdated') {
        const sym = symOfFeed(l.args.feedId)
        out.push({ ...base, kind: 'oracle', sym, actor: 'oracle', detail: `Oracle update ${sym ?? ''}: $${(Number(l.args.priceE8) / 1e8).toFixed(2)}${l.args.sessionOpen ? ' (session open)' : ' (session closed)'}` })
      } else if (l.eventName === 'Minted' || l.eventName === 'Redeemed') {
        const minted = l.eventName === 'Minted'
        const sym = symOfFeed(l.args.feedId)
        const dec = sym ? this.dec[sym] ?? 18 : 18
        const usdcAmt = Number((minted ? l.args.usdcIn : l.args.usdcOut) as bigint) / 10 ** this.usdcDec
        const tokAmt = Number((minted ? l.args.tokensOut : l.args.tokensIn) as bigint) / 10 ** dec
        const actor = this.actorOf(String(l.args.user))
        out.push({ ...base, kind: minted ? 'mint' : 'redeem', sym, actor, detail: `${minted ? 'Minted' : 'Redeemed'} ${tokAmt.toFixed(4)} t${sym ?? ''} for ${usdcAmt.toFixed(2)} USDC (${actor === 'you' ? 'you' : shortAddr(String(l.args.user))})`, sizeUsd: usdcAmt })
      } else if (l.eventName === 'LiquidityChanged') {
        const p = byPool.get(String(l.args.poolId).toLowerCase())
        const delta = l.args.liquidityDelta as bigint
        out.push({ ...base, kind: 'lp', sym: p?.sym, pool: p?.kind, actor: this.actorOf(String(l.args.lp)), detail: `Liquidity ${delta >= 0n ? 'added to' : 'removed from'} the ${p?.kind ?? '?'} pool, ticks ${String(l.args.tickLower)} to ${String(l.args.tickUpper)}` })
        if (acct && String(l.args.lp).toLowerCase() === acct.toLowerCase()) {
          const poolId = String(l.args.poolId) as Hex
          this.ranges.set(`${poolId}:${Number(l.args.tickLower)}:${Number(l.args.tickUpper)}`, { poolId, tickLower: Number(l.args.tickLower), tickUpper: Number(l.args.tickUpper) })
        }
      }
    }
    for (const e of out) this.events.push({ id: this.eventId++, ...e })
    this.feeEvents.push(...feeRows)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    if (this.feeEvents.length > MAX_EVENTS) this.feeEvents.splice(0, this.feeEvents.length - MAX_EVENTS)
    this.lastBlock = head
  }
}

function shortAddr(a: string): string {
  return a.length > 12 ? a.slice(0, 6) + '...' + a.slice(-4) : a
}
