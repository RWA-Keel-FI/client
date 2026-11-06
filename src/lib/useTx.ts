import { useCallback, useState } from 'react'
import type { TradeResult, TxStep } from './market/types.ts'

/** Runs one engine action and tracks its progress (approval -> wallet signature -> confirmation). */
export function useTx() {
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<TxStep | null>(null)
  const [result, setResult] = useState<TradeResult | null>(null)
  const run = useCallback(async (fn: (onStep: (s: TxStep) => void) => Promise<TradeResult>) => {
    setBusy(true)
    setResult(null)
    setStep(null)
    try {
      const r = await fn(setStep)
      setResult(r)
      return r
    } finally {
      setBusy(false)
      setStep(null)
    }
  }, [])
  return { busy, step, result, run, clear: () => setResult(null) }
}
