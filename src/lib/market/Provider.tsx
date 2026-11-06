import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useAccount, useConfig } from 'wagmi'
import { getPublicClient, getWalletClient } from 'wagmi/actions'
import { arcTestnet } from '../chain/arc.ts'
import { loadDeployment } from '../chain/deployment.ts'
import type { DeploymentLoad } from '../chain/deployment.ts'
import { EMPTY_STATE, MarketContext } from './context.ts'
import { ChainEngine } from './chainEngine.ts'
import type { Engine } from './types.ts'

const noopSub = () => () => {}

/** Loads the Arc deployment, owns the engine, and keeps it pointed at the connected account. */
export function MarketProvider({ children }: { children: ReactNode }) {
  const config = useConfig()
  const { address } = useAccount()
  const [deployment, setDeployment] = useState<DeploymentLoad>({ status: 'loading' })
  const [engine, setEngine] = useState<Engine | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let dead = false
    let eng: Engine | null = null
    void (async () => {
      const d = await loadDeployment()
      if (dead) return
      setDeployment(d)
      if (d.status !== 'ready') {
        if (d.status === 'error') setLoadError(d.message)
        return
      }
      try {
        const pub = getPublicClient(config, { chainId: arcTestnet.id })
        if (!pub) throw new Error('No public client for Arc Testnet')
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
        setLoadError('')
        setEngine(eng)
      } catch (e) {
        if (!dead) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      dead = true
      eng?.dispose()
    }
  }, [config])

  useEffect(() => {
    engine?.setAccount(address)
  }, [engine, address])

  const subscribe = useMemo(() => (engine ? (fn: () => void) => engine.subscribe(fn) : noopSub), [engine])
  const getSnapshot = useMemo(() => (engine ? () => engine.getState() : () => EMPTY_STATE), [engine])
  const state = useSyncExternalStore(subscribe, getSnapshot)

  return <MarketContext.Provider value={{ engine, state, deployment, loadError }}>{children}</MarketContext.Provider>
}
