import { DEPLOYMENT_NAME } from '../lib/chain/deployment.ts'
import { useMarket } from '../lib/market/context.ts'
import { explainError } from '../lib/market/errors.ts'

/** Rendered in place of every on-chain page while there is no deployment to read. Shows no numbers at all. */
export function NotDeployed({ onBacktest }: { onBacktest: () => void }) {
  const { deployment, loadError, startup, retry, state } = useMarket()
  if (deployment.status === 'loading') {
    return (
      <div className="nd" role="status">
        <h2>Loading the Arc Testnet deployment...</h2>
      </div>
    )
  }
  if (deployment.status === 'missing') {
    return (
      <div className="nd">
        <h2>Not deployed yet</h2>
        <p>
          The contracts are not on Arc Testnet yet, so there is nothing to trade, mint or provide liquidity against. This app only
          shows data it reads from the chain, so these pages stay empty until a deployment exists. No placeholder numbers are shown.
        </p>
        <p className="sub">
          Expected file: <code>deployments/{DEPLOYMENT_NAME}.json</code>. After the deploy script writes it, run{' '}
          <code>pnpm sync-deployments</code> in <code>client/</code> (it also runs on <code>pnpm dev</code> and <code>pnpm build</code>) and reload.
        </p>
        <button type="button" onClick={onBacktest}>See the historical backtest</button>
      </div>
    )
  }
  if (startup.phase === 'ready') {
    // the engine started but its first read of the chain has not succeeded yet; it keeps polling on its own
    const info = state.error ? explainError(state.error) : null
    return (
      <div className="nd" role={info ? 'alert' : 'status'}>
        <h2>{info ? info.title : 'Loading the first data from Arc Testnet...'}</h2>
        {info && <p className="err">{info.hint}</p>}
        {info && <p className="sub">Still polling every few seconds; this page updates when a read succeeds.</p>}
        {info && (
          <details>
            <summary>Technical details</summary>
            <pre className="nd-detail">{info.detail}</pre>
          </details>
        )}
      </div>
    )
  }
  if (startup.phase === 'connecting') {
    return (
      <div className="nd" role="status">
        <h2>Connecting to Arc Testnet...</h2>
        <p className="sub">
          Reading the contracts{startup.attempt > 1 ? ` (attempt ${startup.attempt} of 4, the public RPC is slow or limiting requests)` : ''}.
        </p>
      </div>
    )
  }
  const info = startup.info
  return (
    <div className="nd">
      <h2>{info?.title ?? 'Could not start the Arc Testnet reader'}</h2>
      <p role="alert" className="err">{info?.hint ?? loadError}</p>
      <p>
        <button type="button" onClick={retry}>Retry now</button>{' '}
        <button type="button" onClick={onBacktest}>See the historical backtest</button>
      </p>
      {info?.transient && <p className="sub">Retrying automatically every 20 seconds.</p>}
      {info && (
        <details>
          <summary>Technical details</summary>
          <pre className="nd-detail">{info.detail}</pre>
        </details>
      )}
    </div>
  )
}
