import { defineChain } from 'viem'
import type { Address } from 'viem'

/**
 * Arc Testnet. Native gas token is USDC with 18 decimals (the chain's accounting unit), while the ERC-20 interface of the
 * same USDC at ARC_USDC uses 6 decimals. Never mix the two: native balances use `formatEther`, ERC-20 amounts use the
 * token's own `decimals()` (6).
 */
export const ARC_CHAIN_ID = 5042002
export const ARC_EXPLORER = 'https://explorer.testnet.arc.network'
export const ARC_PUBLIC_RPC = 'https://rpc.testnet.arc.network'
export const ARC_USDC: Address = '0x3600000000000000000000000000000000000000'
export const ARC_FAUCET = 'https://faucet.circle.com'
/** Native gas currency: 18 decimals. */
export const ARC_NATIVE_DECIMALS = 18
/** ERC-20 interface of USDC: 6 decimals. */
export const ARC_USDC_DECIMALS = 6

/** Optional override, for example a local anvil fork of Arc Testnet (same chain id). Falls back to the public RPC. */
export const ARC_RPC: string = (import.meta.env.VITE_ARC_RPC_URL as string | undefined)?.trim() || ARC_PUBLIC_RPC

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: ARC_NATIVE_DECIMALS },
  rpcUrls: { default: { http: [ARC_PUBLIC_RPC] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: ARC_EXPLORER } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  testnet: true,
})

export const txUrl = (hash: string) => `${ARC_EXPLORER}/tx/${hash}`
export const addressUrl = (addr: string) => `${ARC_EXPLORER}/address/${addr}`
