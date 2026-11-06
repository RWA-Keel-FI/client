import { useCallback, useEffect, useState } from 'react'
import { BacktestPanel } from './components/BacktestPanel.tsx'
import { FeeEvents } from './components/FeeEvents.tsx'
import { NotDeployed } from './components/NotDeployed.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { WalletButton } from './components/WalletButton.tsx'
import { loadBacktest } from './lib/results.ts'
import type { BacktestFile } from './lib/backtest.ts'
import { MarketProvider } from './lib/market/Provider.tsx'
import { useMarket } from './lib/market/context.ts'
import { Flows } from './pages/Flows.tsx'
import { Landing } from './pages/Landing.tsx'
import { Liquidity } from './pages/Liquidity.tsx'
import { Markets } from './pages/Markets.tsx'
import { MintRedeem } from './pages/MintRedeem.tsx'
import { Trade } from './pages/Trade.tsx'
import { BRAND } from './brand.ts'
import { LogoMark } from './components/Logo.tsx'

type Tab = 'markets' | 'trade' | 'mint' | 'lp' | 'flows' | 'fees' | 'backtest'

const TABS: { id: Tab; label: string }[] = [
  { id: 'markets', label: 'Explore' },
  { id: 'trade', label: 'Trade' },
  { id: 'mint', label: 'Mint & redeem' },
  { id: 'lp', label: 'Liquidity' },
  { id: 'flows', label: 'Activity' },
  { id: 'fees', label: 'Fee events' },
  { id: 'backtest', label: 'Backtest' },
]

function Dashboard({ onHome }: { onHome: () => void }) {
  const [tab, setTab] = useState<Tab>('markets')
  const [sym, setSym] = useState('')
  const [query, setQuery] = useState('')
  const { state, engine, deployment } = useMarket()
  const [results, setResults] = useState<BacktestFile | null>(null)

  useEffect(() => {
    void loadBacktest().then(setResults)
  }, [])

  // default to the first ticker the deployment actually has
  const active = sym && engine?.syms.includes(sym) ? sym : (engine?.syms[0] ?? '')
  const live = deployment.status === 'ready' && state.ready

  return (
    <div className="ap">
      <header className="ap-top">
        <a className="ap-logo" href="/" onClick={(e) => { e.preventDefault(); onHome() }}>
          <LogoMark size={30} />
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
        <WalletButton />
        <a className="ap-home" href="/" onClick={(e) => { e.preventDefault(); onHome() }}>Home</a>
      </header>

      <main>
        {tab === 'backtest' ? (
          <div className="banner">
            HISTORICAL BACKTEST: real Ondo-token swaps on Ethereum replayed against the fee rule (server/backtest/results.json). Not live and
            not on Arc Testnet.
          </div>
        ) : (
          <StatusBar />
        )}

        {tab === 'backtest' ? (
          <section aria-label="Backtest results">
            <BacktestPanel results={results} />
          </section>
        ) : !live ? (
          <NotDeployed onBacktest={() => setTab('backtest')} />
        ) : (
          <>
            {tab === 'markets' && (
              <Markets
                query={query}
                onTrade={(s) => {
                  setSym(s)
                  setTab('trade')
                }}
              />
            )}
            {tab === 'trade' && <Trade sym={active} onSym={setSym} />}
            {tab === 'mint' && <MintRedeem sym={active} onSym={setSym} />}
            {tab === 'lp' && <Liquidity sym={active} onSym={setSym} />}
            {tab === 'flows' && <Flows />}
            {tab === 'fees' && <FeeEvents />}
          </>
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
