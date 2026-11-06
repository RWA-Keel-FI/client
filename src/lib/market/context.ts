import { createContext, useContext } from 'react'
import type { Engine, EngineMode, EngineState } from './types.ts'

export interface MarketCtx {
  engine: Engine | null
  state: EngineState
  source: EngineMode
  setSource: (s: EngineMode) => void
  /** why the chain engine could not start, if it could not */
  loadError: string
}

export const EMPTY_STATE: EngineState = {
  mode: 'mock',
  sourceNote: 'Starting...',
  issuerFeeBps: 0,
  markets: [],
  wallet: { address: '', usdc: 0, tokens: {}, basis: {} },
  events: [],
  positions: [],
  reserves: [],
  summary: null,
  sim: { playing: false, speed: 1, simTs: 0 },
}

export const MarketContext = createContext<MarketCtx>({
  engine: null,
  state: EMPTY_STATE,
  source: 'mock',
  setSource: () => {},
  loadError: '',
})

export function useMarket(): MarketCtx {
  return useContext(MarketContext)
}
