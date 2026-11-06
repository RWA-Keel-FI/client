import { createContext, useContext } from 'react'
import type { DeploymentLoad } from '../chain/deployment.ts'
import type { Engine, EngineState } from './types.ts'

export interface MarketCtx {
  engine: Engine | null
  state: EngineState
  /** whether deployments/<name>.json was found and the engine could start */
  deployment: DeploymentLoad
  /** why the engine could not start or keep reading, if it could not */
  loadError: string
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
})

export function useMarket(): MarketCtx {
  return useContext(MarketContext)
}
