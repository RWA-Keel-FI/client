import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors/injected'
import { walletConnect } from 'wagmi/connectors/walletConnect'
import { arcTestnet, ARC_RPC } from './arc.ts'

const raw = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? ''
/** WalletConnect (Reown) project ids are 32 hex chars. Anything else is treated as "not configured". */
export const WALLETCONNECT_PROJECT_ID = /^[0-9a-f]{32}$/i.test(raw) ? raw : ''
export const WALLETCONNECT_CONFIGURED = WALLETCONNECT_PROJECT_ID !== ''

const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  // injected wallets (MetaMask, Rabby, Coinbase extension, ...) are also discovered through EIP-6963 at runtime
  connectors: [
    injected(),
    ...(WALLETCONNECT_CONFIGURED
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: true,
            metadata: {
              name: 'Keel',
              description: 'Deviation-fee Uniswap v4 hook for tokenized-stock pools on Arc Testnet',
              url: origin,
              icons: [`${origin}/logo-512.png`],
            },
          }),
        ]
      : []),
  ],
  transports: { [arcTestnet.id]: http(ARC_RPC, { batch: true }) },
  batch: { multicall: true },
  multiInjectedProviderDiscovery: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
