import { useState } from 'react'
import type { Connector } from 'wagmi'
import { useAccount, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID, ARC_EXPLORER, ARC_PUBLIC_RPC } from './arc.ts'

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

/** True when the connected wallet is on Arc Testnet and can sign. */
export function useCanTransact(): boolean {
  const { isConnected, chainId } = useAccount()
  return isConnected && chainId === ARC_CHAIN_ID
}
