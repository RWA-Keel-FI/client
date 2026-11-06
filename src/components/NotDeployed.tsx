import { DEPLOYMENT_NAME } from '../lib/chain/deployment.ts'
import { useMarket } from '../lib/market/context.ts'

/** Rendered in place of every on-chain page while there is no deployment to read. Shows no numbers at all. */
export function NotDeployed({ onBacktest }: { onBacktest: () => void }) {
  const { deployment, loadError } = useMarket()
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
  return (
    <div className="nd">
      <h2>Could not start the Arc Testnet reader</h2>
      <p role="alert" className="err">{deployment.status === 'error' ? deployment.message : loadError}</p>
      {deployment.status === 'ready' && loadError && <p className="sub">The deployment file was found but reading from the chain failed. Check the RPC and reload.</p>}
    </div>
  )
}
