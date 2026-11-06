import { ARC_CHAIN_ID, ARC_EXPLORER, ARC_RPC } from '../lib/chain/arc.ts'
import { DEPLOYMENT_NAME } from '../lib/chain/deployment.ts'
import { useMarket } from '../lib/market/context.ts'
import { WALLETCONNECT_CONFIGURED } from '../lib/chain/wagmi.ts'

/** One line saying where the data comes from, plus the problems the user can act on. */
export function StatusBar() {
  const { state, deployment, loadError } = useMarket()
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(ARC_RPC)
  return (
    <div className="statusbar">
      <div className="banner">
        <span className={state.ready ? 'dot ok' : 'dot'} aria-hidden="true" />
        {state.ready ? (
          <>
            Live from Arc Testnet (chain {ARC_CHAIN_ID}){local ? ', via a local fork RPC' : ''}. Block{' '}
            <a href={`${ARC_EXPLORER}/block/${state.blockNumber}`} target="_blank" rel="noreferrer">{state.blockNumber.toLocaleString('en-US')}</a>. Deployment{' '}
            <code>{DEPLOYMENT_NAME}</code>. Test tokens only.
          </>
        ) : deployment.status === 'missing' ? (
          <>Arc Testnet (chain {ARC_CHAIN_ID}). Contracts not deployed yet: nothing to read.</>
        ) : (
          <>Connecting to Arc Testnet...</>
        )}
      </div>
      {!WALLETCONNECT_CONFIGURED && (
        <div className="banner mock" role="note">
          WalletConnect is off: set <code>VITE_WALLETCONNECT_PROJECT_ID</code> in <code>client/.env</code> (get a free id at dashboard.reown.com) and restart
          <code> pnpm dev</code>. Browser wallets (MetaMask and others) still work.
        </div>
      )}
      {(state.error || loadError) && deployment.status === 'ready' && (
        <p role="alert" className="err">Chain read problem: {state.error || loadError}</p>
      )}
    </div>
  )
}
