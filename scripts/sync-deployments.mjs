// Copies the local anvil deployment and simulation output into public/ so the dev server and build can serve them.
// Never fails: missing inputs just mean the app runs in mock mode.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = resolve(here, '..')
const root = resolve(app, '..')
const pub = resolve(app, 'public')

function copy(from, to) {
  if (!existsSync(from)) return false
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  return true
}

const found = []
if (copy(resolve(root, 'deployments/local.json'), resolve(pub, 'deployments/local.json'))) found.push('deployments/local.json')
if (copy(resolve(root, 'deployments/abi'), resolve(pub, 'deployments/abi'))) found.push('deployments/abi/')
if (copy(resolve(root, 'server/sim/out/summary.json'), resolve(pub, 'sim/summary.json'))) found.push('sim/summary.json')
if (copy(resolve(root, 'server/sim/out/metrics.jsonl'), resolve(pub, 'sim/metrics.jsonl'))) found.push('sim/metrics.jsonl')
if (found.length === 0) {
  rmSync(resolve(pub, 'deployments'), { recursive: true, force: true })
  console.log('[sync-deployments] nothing to copy, the app will use the mock engine')
} else {
  console.log('[sync-deployments] copied: ' + found.join(', '))
}
