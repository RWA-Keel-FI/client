import { useCallback, useState } from 'react'
import { txUrl } from '../lib/chain/arc.ts'
import { qty, shortHash } from '../lib/market/format.ts'
import type { TradeResult, TxStep } from '../lib/market/types.ts'

export function TxLink({ hash }: { hash: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer">
      <code>{shortHash(hash)}</code>
    </a>
  )
}

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

const STEP_TEXT: Record<TxStep['phase'], string> = {
  'approve-sign': 'Step 1: approve the token in your wallet...',
  'approve-pending': 'Approval sent, waiting for confirmation...',
  sign: 'Confirm the transaction in your wallet...',
  pending: 'Transaction sent, waiting for confirmation...',
}

export function TxStatus({ busy, step, result, unit, verb = 'Done' }: { busy: boolean; step: TxStep | null; result: TradeResult | null; unit?: string; verb?: string }) {
  if (busy) {
    return (
      <div role="status" className="result pending">
        {step ? STEP_TEXT[step.phase] : 'Preparing and simulating the transaction...'}
        {step?.hash && (
          <>
            {' '}
            <TxLink hash={step.hash} />
          </>
        )}
      </div>
    )
  }
  if (!result) return null
  return (
    <div role="status" className={result.ok ? 'result ok' : 'result bad'}>
      {result.ok ? (
        <>
          {verb}
          {result.filledOut !== undefined ? `: received ${qty(result.filledOut, 6)}${unit ? ' ' + unit : ''}` : ''}.
          {result.approveHash && (
            <>
              {' '}
              Approval <TxLink hash={result.approveHash} />.
            </>
          )}
          {result.hash && (
            <>
              {' '}
              Tx <TxLink hash={result.hash} />
            </>
          )}
        </>
      ) : (
        <>Not executed: {result.error}</>
      )}
    </div>
  )
}
