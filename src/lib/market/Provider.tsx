import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { EMPTY_STATE, MarketContext } from './context.ts'
import { MockEngine } from './mockEngine.ts'
import type { Engine, EngineMode } from './types.ts'

const noopSub = () => () => {}

function initialSource(): EngineMode {
  try {
    const saved = localStorage.getItem('dfee.source')
    if (saved === 'chain' || saved === 'mock') return saved
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_ENGINE === 'chain' ? 'chain' : 'mock'
}

/** Owns the engine (mock or anvil) and re-renders consumers whenever its state changes. */
export function MarketProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<EngineMode>(initialSource)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [loadError, setLoadError] = useState('')

  const setSource = useCallback((s: EngineMode) => {
    try {
      localStorage.setItem('dfee.source', s)
    } catch {
      /* storage unavailable */
    }
    setSourceState(s)
  }, [])

  useEffect(() => {
    let dead = false
    let eng: Engine | null = null
    void (async () => {
      try {
        eng = source === 'mock' ? new MockEngine() : await (await import('./chainEngine.ts')).ChainEngine.create()
        if (dead) {
          eng.dispose()
          return
        }
        setLoadError('')
        setEngine(eng)
      } catch (e) {
        if (dead) return
        setLoadError(e instanceof Error ? e.message : String(e))
        setSourceState('mock')
      }
    })()
    return () => {
      dead = true
      eng?.dispose()
    }
  }, [source])

  const subscribe = useMemo(() => (engine ? (fn: () => void) => engine.subscribe(fn) : noopSub), [engine])
  const getSnapshot = useMemo(() => (engine ? () => engine.getState() : () => EMPTY_STATE), [engine])
  const state = useSyncExternalStore(subscribe, getSnapshot)

  return <MarketContext.Provider value={{ engine, state, source, setSource, loadError }}>{children}</MarketContext.Provider>
}
