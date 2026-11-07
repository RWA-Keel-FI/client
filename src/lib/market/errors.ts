/** Turns a chain-read failure into something a person can act on. The raw text is always kept in `detail`. */
export type ErrorKind = 'rate-limit' | 'network' | 'timeout' | 'wrong-chain' | 'contract' | 'deployment' | 'unknown'

export interface ErrorInfo {
  kind: ErrorKind
  title: string
  hint: string
  /** the underlying message, trimmed, for a "details" disclosure */
  detail: string
  /** true when trying again can plausibly succeed without any change from the user */
  transient: boolean
}

function rawMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { shortMessage?: string; message?: string; cause?: unknown; details?: string }
    const parts = [o.shortMessage ?? o.message ?? '', o.details ?? '']
    const c = o.cause as { shortMessage?: string; message?: string } | undefined
    if (c) parts.push(c.shortMessage ?? c.message ?? '')
    const joined = parts.filter(Boolean).join(' | ')
    if (joined) return joined
  }
  return String(e)
}

export function explainError(e: unknown): ErrorInfo {
  const text = rawMessage(e)
  const detail = text.length > 600 ? `${text.slice(0, 600)}...` : text
  const has = (re: RegExp) => re.test(text)
  if (has(/429|rate.?limit|too many requests|-32005/i)) {
    return {
      kind: 'rate-limit',
      title: 'The Arc public RPC is rate limiting this browser',
      hint: 'The free endpoint allows very few requests. It retries on its own. For a stable app, set VITE_ARC_RPC_URL in client/.env to a dedicated Arc Testnet RPC and restart the dev server.',
      detail,
      transient: true,
    }
  }
  if (has(/timed? ?out|timeout|aborted/i)) {
    return { kind: 'timeout', title: 'The Arc RPC did not answer in time', hint: 'The network or the endpoint is slow. It retries on its own.', detail, transient: true }
  }
  if (has(/failed to fetch|networkerror|load failed|fetch failed|econn|enotfound|net::|offline/i)) {
    return {
      kind: 'network',
      title: 'Cannot reach the Arc RPC',
      hint: 'Check your internet connection, a VPN or ad blocker that blocks rpc.testnet.arc.network, or a wrong VITE_ARC_RPC_URL.',
      detail,
      transient: true,
    }
  }
  if (has(/rpc is on chain|chain id|chainid/i)) {
    return {
      kind: 'wrong-chain',
      title: 'The RPC is on a different chain than the deployment',
      hint: 'VITE_ARC_RPC_URL must point to Arc Testnet (chain id 5042002), or VITE_DEPLOYMENT names a deployment for another chain.',
      detail,
      transient: false,
    }
  }
  if (has(/deployment|json|unexpected token|abi/i)) {
    return {
      kind: 'deployment',
      title: 'The deployment files could not be read',
      hint: 'Run pnpm sync-deployments in client/ and reload. The files must be served from /deployments/.',
      detail,
      transient: false,
    }
  }
  if (has(/revert|returned no data|zero data|contractfunction|execution/i)) {
    return {
      kind: 'contract',
      title: 'A contract call failed',
      hint: 'The addresses in the deployment file may not match the chain, or the contracts were redeployed. Re-sync the deployment and reload.',
      detail,
      transient: false,
    }
  }
  return { kind: 'unknown', title: 'Could not read from Arc Testnet', hint: 'Use Retry. If it keeps failing, the details below say why.', detail, transient: true }
}
