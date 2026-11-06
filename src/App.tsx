import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BacktestPanel } from './components/BacktestPanel.tsx'
import { FeeChart } from './components/FeeChart.tsx'
import { SimBar } from './components/SimBar.tsx'
import { SwapTable } from './components/SwapTable.tsx'
import { DEFAULT_CFG } from './lib/fee.ts'
import { fetchLiveSwaps, readLiveConfig } from './lib/live.ts'
import { generateMockSwaps } from './lib/mock.ts'
import { loadBacktest } from './lib/results.ts'
import type { BacktestFile } from './lib/backtest.ts'
import { MarketProvider } from './lib/market/Provider.tsx'
import { useMarket } from './lib/market/context.ts'
import { usd } from './lib/market/format.ts'
import { Flows } from './pages/Flows.tsx'
import { Landing } from './pages/Landing.tsx'
import { Liquidity } from './pages/Liquidity.tsx'
import { Markets } from './pages/Markets.tsx'
import { MintRedeem } from './pages/MintRedeem.tsx'
import { Trade } from './pages/Trade.tsx'
import type { Mode, SwapRow } from './lib/types.ts'
import { BRAND } from './brand.ts'

type Tab = 'markets' | 'trade' | 'mint' | 'lp' | 'flows' | 'live' | 'swaps' | 'backtest'

const TABS: { id: Tab; label: string }[] = [
  { id: 'markets', label: 'Explore' },
  { id: 'trade', label: 'Trade' },
  { id: 'mint', label: 'Mint & redeem' },
  { id: 'lp', label: 'Liquidity' },
  { id: 'flows', label: 'Flows' },
  { id: 'live', label: 'Fee curve' },
  { id: 'swaps', label: 'Swap log' },
  { id: 'backtest', label: 'Backtest' },
]
const OLD_TABS: Tab[] = ['live', 'swaps']

function Dashboard({ onHome }: { onHome: () => void }) {
  const [tab, setTab] = useState<Tab>('markets')
  const [sym, setSym] = useState('NVDA')
  const [query, setQuery] = useState('')
  const { state } = useMarket()
  const [mode, setMode] = useState<Mode>(import.meta.env.VITE_MODE === 'live' ? 'live' : 'replay')
  const [results, setResults] = useState<BacktestFile | null>(null)

  const mock = useMemo(() => generateMockSwaps(DEFAULT_CFG), [])
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const [liveRows, setLiveRows] = useState<SwapRow[]>([])
  const [liveMsg, setLiveMsg] = useState('')
  const liveCfg = useMemo(() => readLiveConfig(), [])

  useEffect(() => {
    void loadBacktest().then(setResults)
  }, [])

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => {
      setCursor((c) => {
        if (c >= mock.length) {
          setPlaying(false)
          return c
        }
        return c + 1
      })
    }, 350)
    return () => window.clearInterval(timer.current)
  }, [playing, mock.length])

  const loadLive = useCallback(async () => {
    if (!liveCfg) {
      setLiveMsg('Live mode needs VITE_RPC_URL, VITE_HOOK_ADDRESS and VITE_POOL_ID. Showing nothing; switch to replay.')
      return
    }
    setLiveMsg('Loading FeeSet logs...')
    try {
      const rows = await fetchLiveSwaps(liveCfg, DEFAULT_CFG)
      setLiveRows(rows)
      setLiveMsg(rows.length === 0 ? 'No FeeSet events in the block range yet.' : '')
    } catch (e) {
      setLiveMsg(`Live fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [liveCfg])

  useEffect(() => {
    if (mode === 'live') void loadLive()
  }, [mode, loadLive])

  const rows = mode === 'replay' ? mock.slice(0, cursor) : liveRows
  const armedCount = rows.filter((r) => r.armed).length

  return (
    <div className="ap">
      <header className="ap-top">
        <a className="ap-logo" href="/" onClick={(e) => { e.preventDefault(); onHome() }}>
          <svg width="30" height="30" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M5 16 L10 16 L15 8 L21 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{BRAND}</span>
        </a>
        <nav className="ap-nav" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <label className="ap-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.500-3.500" /></svg>
          <input
            type="search"
            placeholder="Search assets"
            aria-label="Search assets"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (e.target.value) setTab('markets')
            }}
          />
        </label>
        <span className="ap-wallet" title="Test wallet balance">{usd(state.wallet.usdc, 2)} tUSDC</span>
        <a className="ap-home" href="/" onClick={(e) => { e.preventDefault(); onHome() }}>Home</a>
      </header>

      <main>
        {tab === 'backtest' ? (
          <div className="banner">
            BACKTEST: real Ondo-token swaps on Ethereum replayed against the fee rule (backtest/results.json). Not live and
            not on a testnet.
          </div>
        ) : OLD_TABS.includes(tab) ? (
          <div className={mode === 'replay' ? 'banner mock' : 'banner'}>
            {mode === 'replay'
              ? 'REPLAY MODE: mock data generated in the browser. Not market data, no chain connection.'
              : 'LIVE MODE: FeeSet events read from the configured RPC. Size and direction are not in the event.'}
          </div>
        ) : (
          <details className="ap-sim">
            <summary>
              <i className={state.mode === 'mock' ? 'mock' : ''} aria-hidden="true" />
              <span>{state.sourceNote}</span>
              <em>Simulator</em>
            </summary>
            <SimBar hideBanner />
          </details>
        )}
        {OLD_TABS.includes(tab) && (
          <div className="controls ap-replay">
            <button type="button" aria-pressed={mode === 'replay'} onClick={() => setMode('replay')}>Replay</button>
            <button type="button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live</button>
            {mode === 'replay' ? (
              <>
                <button type="button" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : cursor >= mock.length ? 'Done' : 'Play'}</button>
                <button type="button" onClick={() => { setPlaying(false); setCursor(0) }}>Reset</button>
                <button type="button" onClick={() => setCursor(mock.length)}>Show all</button>
              </>
            ) : (
              <button type="button" onClick={() => void loadLive()}>Refresh</button>
            )}
          </div>
        )}

      {OLD_TABS.includes(tab) && mode === 'live' && liveMsg && <p role="status">{liveMsg}</p>}

      {tab === 'markets' && (
        <Markets
          query={query}
          onTrade={(s) => {
            setSym(s)
            setTab('trade')
          }}
        />
      )}
      {tab === 'trade' && <Trade sym={sym} onSym={setSym} />}
      {tab === 'mint' && <MintRedeem sym={sym} onSym={setSym} />}
      {tab === 'lp' && <Liquidity sym={sym} onSym={setSym} />}
      {tab === 'flows' && <Flows />}

      {tab === 'live' && (
        <section aria-label="Fee versus deviation">
          <p>
            {rows.length} swaps shown, {armedCount} surcharged ({rows.length ? ((armedCount / rows.length) * 100).toFixed(1) : '0.0'}%).
            Each dot is one swap; larger dots paid a surcharge.
          </p>
          <FeeChart rows={rows} cfg={DEFAULT_CFG} />
        </section>
      )}
      {tab === 'swaps' && (
        <section aria-label="Swaps">
          <SwapTable rows={rows} />
        </section>
      )}
      {tab === 'backtest' && (
        <section aria-label="Backtest results">
          <BacktestPanel results={results} />
        </section>
      )}
    </main>
    </div>
  )
}

const isAppPath = () => window.location.pathname.replace(/\/+$/, '') === '/app'

export default function App() {
  const [inApp, setInApp] = useState(isAppPath)

  useEffect(() => {
    const onPop = () => setInApp(isAppPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((app: boolean) => {
    window.history.pushState(null, '', app ? '/app' : '/')
    window.scrollTo(0, 0)
    setInApp(app)
  }, [])

  if (!inApp) return <Landing onLaunch={() => go(true)} />
  return (
    <MarketProvider>
      <Dashboard onHome={() => go(false)} />
    </MarketProvider>
  )
}
