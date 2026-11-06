import type { PoolCfg, Reason, SwapRow } from './types.ts'

/** keccak256("FeeSet(bytes32,uint24,uint24,uint32,bool)"), see ARCHITECTURE.md 4.3 */
export const FEESET_TOPIC0 = '0x3dc5a175e5eb8cfd85251dc788fbdfaf328b22a7ab9225019d1ea6f198a02b44'

export interface LiveConfig {
  rpcUrl: string
  hookAddress: string
  poolId: string
  fromBlocks: number
}

export function readLiveConfig(): LiveConfig | null {
  const env = import.meta.env
  const rpcUrl = env.VITE_RPC_URL
  const hookAddress = env.VITE_HOOK_ADDRESS
  const poolId = env.VITE_POOL_ID
  if (!rpcUrl || !hookAddress || !poolId) return null
  return { rpcUrl, hookAddress, poolId, fromBlocks: Number(env.VITE_FROM_BLOCKS ?? 5000) }
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = (await r.json()) as { result?: T; error?: { message: string } }
  if (j.error) throw new Error(j.error.message)
  return j.result as T
}

interface RawLog {
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

/**
 * Reads FeeSet logs and turns them into rows. UNTESTED against a deployed hook.
 * The event has no swap size or direction, so those fields stay undefined.
 * The reason is inferred: armed means surcharge; otherwise the fee equals f0, and we cannot tell
 * which fail-open branch applied, so non-armed rows are labelled by what the data can show.
 */
export async function fetchLiveSwaps(cfg: LiveConfig, poolCfg: PoolCfg): Promise<SwapRow[]> {
  const head = parseInt(await rpc<string>(cfg.rpcUrl, 'eth_blockNumber', []), 16)
  const from = Math.max(head - cfg.fromBlocks, 0)
  const logs = await rpc<RawLog[]>(cfg.rpcUrl, 'eth_getLogs', [
    {
      address: cfg.hookAddress,
      fromBlock: '0x' + from.toString(16),
      toBlock: 'latest',
      topics: [FEESET_TOPIC0, cfg.poolId],
    },
  ])
  const blockTs = new Map<string, number>()
  for (const b of new Set(logs.map((l) => l.blockNumber))) {
    const blk = await rpc<{ timestamp: string }>(cfg.rpcUrl, 'eth_getBlockByNumber', [b, false])
    blockTs.set(b, parseInt(blk.timestamp, 16))
  }
  return logs.map((l) => {
    const w = (i: number) => BigInt('0x' + l.data.slice(2 + 64 * i, 2 + 64 * (i + 1)))
    const feePips = Number(w(0))
    const f0Pips = Number(w(1))
    const devBps = Number(w(2))
    const armed = w(3) === 1n
    const reason: Reason = armed ? 'surcharge' : devBps / 2 <= f0Pips / 100 ? 'inside-deadband' : 'non-arbitrage-direction'
    return {
      id: `${l.transactionHash}-${parseInt(l.logIndex, 16)}`,
      ts: blockTs.get(l.blockNumber) ?? 0,
      pool: 'live',
      deviationBps: devBps,
      baseFeeBps: f0Pips / 100 || poolCfg.f0Bps,
      chargedFeeBps: feePips / 100,
      armed,
      reason,
    }
  })
}
