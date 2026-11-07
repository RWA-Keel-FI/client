import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useAccount, useConfig } from 'wagmi'
import { getPublicClient, getWalletClient } from 'wagmi/actions'
import { arcTestnet } from '../chain/arc.ts'
import { loadDeployment } from '../chain/deployment.ts'
import type { DeploymentLoad } from '../chain/deployment.ts'
import { EMPTY_STATE, MarketContext } from './context.ts'
import type { MarketCtx } from './context.ts'
import { ChainEngine } from './chainEngine.ts'
import { explainError } from './errors.ts'
import type { Engine } from './types.ts'

const noopSub = () => () => {}
const MAX_ATTEMPTS = 4
const BACKOFF_MS = [1500, 3000, 6000]
const AUTO_RETRY_MS = 20_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Loads the Arc deployment, owns the engine, and keeps it pointed at the connected account. */
export function MarketProvider({ children }: { children: ReactNode }) {
  const config = useConfig()
  const { address } = useAccount()
  const [deployment, setDeployment] = useState<DeploymentLoad>({ status: 'loading' })
  const [engine, setEngine] = useState<Engine | null>(null)
  const [startup, setStartup] = useState<MarketCtx['startup']>({ phase: 'connecting', attempt: 0, info: null })
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let dead = false
    let eng: Engine | null = null
    let autoRetry = 0
    void (async () => {
      setStartup({ phase: 'connecting', attempt: 1, info: null })
      const d = await loadDeployment()
      if (dead) return
      setDeployment(d)
      if (d.status === 'error') {
        setStartup({ phase: 'failed', attempt: 1, info: explainError(new Error(`deployment: ${d.message}`)) })
        autoRetry = window.setTimeout(retry, AUTO_RETRY_MS)
        return
      }
      if (d.status !== 'ready') return
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (dead) return
        setStartup({ phase: 'connecting', attempt, info: null })
        try {
          const pub = getPublicClient(config, { chainId: arcTestnet.id })
          if (!pub) throw new Error('No public client for Arc Testnet (wagmi config has no transport for chain 5042002)')
          eng = await ChainEngine.create({
            pub: pub as never,
            getWallet: () => getWalletClient(config, { chainId: arcTestnet.id }) as never,
            dep: d.dep,
            abis: d.abis,
          })
          if (dead) {
            eng.dispose()
            return
          }
          setEngine(eng)
          setStartup({ phase: 'ready', attempt, info: null })
          return
        } catch (e) {
          if (dead) return
          const info = explainError(e)
          console.error('[keel] Arc reader start failed (attempt ' + attempt + '):', e)
          if (!info.transient || attempt === MAX_ATTEMPTS) {
            setStartup({ phase: 'failed', attempt, info })
            // transient failures heal on their own: keep trying in the background
            if (info.transient) autoRetry = window.setTimeout(retry, AUTO_RETRY_MS)
            return
          }
          await sleep(BACKOFF_MS[attempt - 1] ?? 6000)
        }
      }
    })()
    return () => {
      dead = true
      window.clearTimeout(autoRetry)
      eng?.dispose()
    }
  }, [config, nonce, retry])

  useEffect(() => {
    engine?.setAccount(address)
  }, [engine, address])

  const subscribe = useMemo(() => (engine ? (fn: () => void) => engine.subscribe(fn) : noopSub), [engine])
  const getSnapshot = useMemo(() => (engine ? () => engine.getState() : () => EMPTY_STATE), [engine])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const loadError = startup.phase === 'failed' && startup.info ? `${startup.info.title}. ${startup.info.detail}` : ''

  return <MarketContext.Provider value={{ engine, state, deployment, loadError, startup, retry }}>{children}</MarketContext.Provider>
}
