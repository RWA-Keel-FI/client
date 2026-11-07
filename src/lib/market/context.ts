import { createContext, useContext } from 'react'
import type { DeploymentLoad } from '../chain/deployment.ts'
import type { Engine, EngineState } from './types.ts'
import type { ErrorInfo } from './errors.ts'

export interface MarketCtx {
  engine: Engine | null
  state: EngineState
  /** whether deployments/<name>.json was found and the engine could start */
  deployment: DeploymentLoad
  /** why the engine could not start or keep reading, if it could not */
  loadError: string
  /** where startup is: connecting (with the attempt number), ready, or failed (with a classified reason) */
  startup: { phase: 'connecting' | 'ready' | 'failed'; attempt: number; info: ErrorInfo | null }
  /** start over now (also happens automatically every 20 s while failed) */
  retry: () => void
}

export const EMPTY_STATE: EngineState = {
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

export const MarketContext = createContext<MarketCtx>({
  engine: null,
  state: EMPTY_STATE,
  deployment: { status: 'loading' },
  loadError: '',
  startup: { phase: 'connecting', attempt: 0, info: null },
  retry: () => {},
})

export function useMarket(): MarketCtx {
  return useContext(MarketContext)
}
