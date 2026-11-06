import type { Abi, Address, Hex } from 'viem'
import { ARC_CHAIN_ID } from './arc.ts'

/** Which deployments/<name>.json to read. `arc-fork` is the local anvil fork used for development. */
export const DEPLOYMENT_NAME: string = (import.meta.env.VITE_DEPLOYMENT as string | undefined)?.trim() || 'arc-testnet'

export interface PoolKeyJson {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

export interface PoolJson {
  poolId: Hex
  key: PoolKeyJson
}

export interface TickerDeploy {
  feedId: Hex
  token: Address
  stockIsCurrency0?: boolean
  hookPool: PoolJson
  controlPool?: PoolJson
}

export interface Deployment {
  chainId: number
  poolManager: Address
  oracle: Address
  hook: Address
  usdc: Address
  issuer: Address
  swapRouter: Address
  liquidityRouter: Address
  startBlock?: number
  baseFeePips?: number
  tickers: Record<string, TickerDeploy>
}

const ABI_FILES = {
  oracle: 'RefPriceOracle',
  hook: 'DeviationFeeHook',
  pm: 'PoolManager',
  token: 'StockToken',
  issuer: 'StockIssuer',
  router: 'SwapRouter',
  lrouter: 'LiquidityRouter',
} as const
export type AbiKey = keyof typeof ABI_FILES
export type Abis = Record<AbiKey | 'erc20', Abi>

export type DeploymentLoad =
  | { status: 'loading' }
  | { status: 'missing'; name: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; dep: Deployment; abis: Abis }

const isAddr = (x: unknown): x is Address => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)
const isPool = (x: unknown): x is PoolJson => {
  const p = x as PoolJson | undefined
  return !!p && /^0x[0-9a-fA-F]{64}$/.test(String(p.poolId)) && !!p.key && isAddr(p.key.currency0) && isAddr(p.key.currency1) && isAddr(p.key.hooks)
}

/** A missing file must not be confused with Vite's SPA fallback, which answers unknown paths with index.html (HTTP 200). */
async function fetchJson(url: string): Promise<unknown | null> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) return null
  const text = await r.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function validate(j: unknown): Deployment {
  const d = j as Partial<Deployment> | null
  if (!d || typeof d !== 'object') throw new Error('deployment file is not an object')
  if (Number(d.chainId) !== ARC_CHAIN_ID) throw new Error(`deployment is for chain ${String(d.chainId)}, this app targets Arc Testnet (${ARC_CHAIN_ID})`)
  for (const k of ['poolManager', 'oracle', 'hook', 'usdc', 'issuer', 'swapRouter', 'liquidityRouter'] as const) {
    if (!isAddr(d[k])) throw new Error(`deployment is missing a valid "${k}" address`)
  }
  const tickers = d.tickers
  if (!tickers || typeof tickers !== 'object' || Object.keys(tickers).length === 0) throw new Error('deployment lists no tickers')
  for (const [sym, t] of Object.entries(tickers)) {
    if (!isAddr(t.token) || !/^0x[0-9a-fA-F]{64}$/.test(String(t.feedId)) || !isPool(t.hookPool)) throw new Error(`ticker ${sym} is incomplete in the deployment file`)
    if (t.controlPool && !isPool(t.controlPool)) throw new Error(`ticker ${sym} has a malformed controlPool`)
  }
  return { ...(d as Deployment), chainId: Number(d.chainId) }
}

async function loadAbi(file: string): Promise<Abi> {
  const j = await fetchJson(`/deployments/abi/${file}.json`)
  const abi = Array.isArray(j) ? j : (j as { abi?: unknown } | null)?.abi
  if (!Array.isArray(abi)) throw new Error(`ABI ${file}.json is missing. Run \`pnpm sync-deployments\`.`)
  return abi as Abi
}

const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const satisfies Abi

export async function loadDeployment(): Promise<DeploymentLoad> {
  try {
    const raw = await fetchJson(`/deployments/${DEPLOYMENT_NAME}.json`)
    if (raw === null) return { status: 'missing', name: DEPLOYMENT_NAME }
    const dep = validate(raw)
    const entries = await Promise.all((Object.entries(ABI_FILES) as [AbiKey, string][]).map(async ([k, f]) => [k, await loadAbi(f)] as const))
    const abis = { ...Object.fromEntries(entries), erc20: ERC20_ABI as unknown as Abi } as Abis
    return { status: 'ready', dep, abis }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}
