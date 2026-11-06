import { useEffect, useRef, useState } from 'react'
import type { Connector } from 'wagmi'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID, ARC_EXPLORER, ARC_PUBLIC_RPC, addressUrl, arcTestnet } from '../lib/chain/arc.ts'
import { WALLETCONNECT_CONFIGURED } from '../lib/chain/wagmi.ts'
import { useMarket } from '../lib/market/context.ts'
import { qty, usd } from '../lib/market/format.ts'

const short = (a: string) => a.slice(0, 6) + '...' + a.slice(-4)

interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>
}

/** wallet_addEthereumChain with Arc Testnet's parameters. Native currency is USDC with 18 decimals (the gas unit). */
export async function addArcToWallet(connector: Connector): Promise<void> {
  const provider = (await connector.getProvider()) as Eip1193
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: '0x' + ARC_CHAIN_ID.toString(16),
        chainName: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: [ARC_PUBLIC_RPC],
        blockExplorerUrls: [ARC_EXPLORER],
      },
    ],
  })
}

/** Switches the wallet to Arc Testnet; wagmi adds the network first when the wallet does not know it. Falls back to a direct add. */
export function useSwitchToArc() {
  const { switchChainAsync, isPending } = useSwitchChain()
  const { connector } = useAccount()
  const [error, setError] = useState('')
  const run = async () => {
    setError('')
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID })
    } catch (e) {
      try {
        if (!connector) throw e
        await addArcToWallet(connector)
        await switchChainAsync({ chainId: ARC_CHAIN_ID })
      } catch (e2) {
        setError(e2 instanceof Error ? (e2.message.split('\n')[0] ?? 'Could not switch network') : 'Could not switch network')
      }
    }
  }
  return { run, isPending, error }
}

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const { connectors, connectAsync, isPending, variables } = useConnect()
  const [error, setError] = useState('')
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const wc = connectors.find((c) => c.type === 'walletConnect')
  // EIP-6963 announces each installed wallet as its own connector. The generic "Injected" entry only matters when none were announced.
  const announced = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
  const generic = connectors.find((c) => c.id === 'injected')
  const browser = announced.length > 0 ? announced : generic ? [generic] : []
  const hasProvider = typeof window !== 'undefined' && 'ethereum' in window

  async function pick(c: Connector) {
    setError('')
    try {
      await connectAsync({ connector: c, chainId: ARC_CHAIN_ID })
      onClose()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(/reject|denied|closed/i.test(m) ? 'Connection cancelled.' : (m.split('\n')[0] ?? m))
    }
  }

  return (
    <dialog ref={ref} className="wd" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label="Connect a wallet">
      <div className="wd-body">
        <header>
          <h2>Connect a wallet</h2>
          <button type="button" className="wd-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <p className="sub">Arc Testnet only. Test tokens, no real money. Your keys stay in your wallet; this app never sees them.</p>
        <ul>
          <li>
            {wc ? (
              <button type="button" className="wd-opt" disabled={isPending} onClick={() => void pick(wc)}>
                <strong>WalletConnect</strong>
                <span>{isPending && variables?.connector === wc ? 'Opening...' : 'Scan a QR code with a mobile wallet'}</span>
              </button>
            ) : (
              <div className="wd-opt off" role="note">
                <strong>WalletConnect unavailable</strong>
                <span>
                  Set <code>VITE_WALLETCONNECT_PROJECT_ID</code> in <code>client/.env</code> (free project id from dashboard.reown.com), then restart the
                  dev server.
                </span>
              </div>
            )}
          </li>
          {browser.map((c) => (
            <li key={c.uid}>
              <button type="button" className="wd-opt" disabled={isPending} onClick={() => void pick(c)}>
                <span className="wd-name">
                  {c.icon && <img src={c.icon} alt="" width={24} height={24} />}
                  <strong>{c.id === 'injected' ? 'Browser wallet' : c.name}</strong>
                </span>
                <span>{isPending && variables?.connector === c ? 'Check your wallet...' : 'Browser extension'}</span>
              </button>
            </li>
          ))}
          {browser.length > 0 && !hasProvider && announced.length === 0 && (
            <li className="sub">No browser wallet detected. Install MetaMask or use WalletConnect.</li>
          )}
        </ul>
        {!WALLETCONNECT_CONFIGURED && wc === undefined && browser.length === 0 && <p className="err">No wallet connectors available.</p>}
        {error && <p role="alert" className="err">{error}</p>}
      </div>
    </dialog>
  )
}

export function WalletButton() {
  const { address, isConnected, chainId, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { state } = useMarket()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const sw = useSwitchToArc()
  const wrong = isConnected && chainId !== ARC_CHAIN_ID

  if (!isConnected || !address) {
    return (
      <>
        <button type="button" className="ap-connect" onClick={() => setOpen(true)}>Connect wallet</button>
        {open && <ConnectDialog onClose={() => setOpen(false)} />}
      </>
    )
  }

  return (
    <div className="ap-acct">
      {wrong ? (
        <button type="button" className="ap-wrong" disabled={sw.isPending} onClick={() => void sw.run()} title="Your wallet is on another network">
          {sw.isPending ? 'Switching...' : 'Switch to Arc Testnet'}
        </button>
      ) : (
        <span className="ap-net" title={`${arcTestnet.name}, chain ${ARC_CHAIN_ID}`}><i aria-hidden="true" /> Arc Testnet</span>
      )}
      <button type="button" className="ap-addr" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {!wrong && <span className="ap-bal">{usd(state.wallet.usdc, 2)} USDC</span>}
        <span>{short(address)}</span>
      </button>
      {menu && (
        <div className="ap-menu" role="menu">
          <p className="sub">{connector?.name ?? 'Wallet'}</p>
          <dl className="kv">
            <dt>USDC (ERC-20, 6 dec)</dt>
            <dd>{usd(state.wallet.usdc, 4)}</dd>
            <dt>USDC (gas, 18 dec)</dt>
            <dd>{qty(state.wallet.native, 6)}</dd>
          </dl>
          <button type="button" role="menuitem" onClick={() => { void navigator.clipboard?.writeText(address); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }}>
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <a role="menuitem" href={addressUrl(address)} target="_blank" rel="noreferrer">View on explorer</a>
          <a role="menuitem" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get test USDC</a>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); disconnect() }}>Disconnect</button>
        </div>
      )}
      {sw.error && <p role="alert" className="err ap-err">{sw.error}</p>}
    </div>
  )
}

/** Shown above actions: connect first, then switch networks. Returns null when the user can transact. */
export function ActionGate() {
  const { isConnected, chainId } = useAccount()
  const [open, setOpen] = useState(false)
  const sw = useSwitchToArc()
  if (!isConnected) {
    return (
      <div className="gate">
        <p>Connect a wallet to continue.</p>
        <button type="button" className="primary" onClick={() => setOpen(true)}>Connect wallet</button>
        {open && <ConnectDialog onClose={() => setOpen(false)} />}
      </div>
    )
  }
  if (chainId !== ARC_CHAIN_ID) {
    return (
      <div className="gate">
        <p>Your wallet is on another network. This app runs on Arc Testnet (chain {ARC_CHAIN_ID}).</p>
        <button type="button" className="primary" disabled={sw.isPending} onClick={() => void sw.run()}>
          {sw.isPending ? 'Check your wallet...' : 'Switch to Arc Testnet'}
        </button>
        {sw.error && <p role="alert" className="err">{sw.error}</p>}
      </div>
    )
  }
  return null
}

/** True when the connected wallet is on Arc Testnet and can sign. */
export function useCanTransact(): boolean {
  const { isConnected, chainId } = useAccount()
  return isConnected && chainId === ARC_CHAIN_ID
}
