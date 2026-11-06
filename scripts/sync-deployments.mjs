// Copies the Arc Testnet deployment (and the ABIs and backtest results) into public/ so the dev server and build can serve them.
// Never fails: when deployments/arc-testnet.json does not exist yet the app shows a "Not deployed yet" state. There is no mock fallback.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = resolve(here, '..')
const root = resolve(app, '..')
const pub = resolve(app, 'public')
// Source folders in priority order: ../deployments (written by server/scripts/deploy-arc.sh) wins over the copy committed in this repo
// (client/deployments), so a fresh clone of only this repo still shows the real Arc Testnet deployment.
const sources = [resolve(root, 'deployments'), resolve(app, 'deployments')]
const firstWith = (rel) => sources.map((d) => resolve(d, rel)).find((p) => existsSync(p))

function copy(from, to) {
  if (!existsSync(from)) return false
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  return true
}

// start clean so a deployment file that was removed (or an old local one) is not served stale
rmSync(resolve(pub, 'deployments'), { recursive: true, force: true })
rmSync(resolve(pub, 'sim'), { recursive: true, force: true })

const found = []
// arc-testnet.json is the real deployment; arc-fork.json is the local anvil fork of Arc Testnet (select it with VITE_DEPLOYMENT=arc-fork)
for (const name of ['arc-testnet', 'arc-fork']) {
  const from = firstWith(`${name}.json`)
  if (from && copy(from, resolve(pub, `deployments/${name}.json`))) found.push(`deployments/${name}.json`)
}
const abiFrom = firstWith('abi')
if (found.length > 0 && abiFrom && copy(abiFrom, resolve(pub, 'deployments/abi'))) found.push('deployments/abi/')
if (copy(resolve(root, 'server/backtest/results.json'), resolve(pub, 'results.json'))) found.push('backtest/results.json')

if (!found.some((f) => f.startsWith('deployments/arc'))) {
  const have = existsSync(resolve(root, 'deployments')) ? readdirSync(resolve(root, 'deployments')).filter((f) => f.endsWith('.json')) : []
  console.log(`[sync-deployments] deployments/arc-testnet.json not found (have: ${have.join(', ') || 'nothing'}). The app will show "Not deployed yet".`)
} else {
  console.log('[sync-deployments] copied: ' + found.join(', '))
}
