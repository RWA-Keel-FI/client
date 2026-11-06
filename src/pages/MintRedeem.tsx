import { useState } from 'react'
import { useMarket } from '../lib/market/context.ts'
import { qty, shortHash, usd } from '../lib/market/format.ts'
import type { TradeResult } from '../lib/market/types.ts'

function Result({ r, mock }: { r: TradeResult | null; mock: boolean }) {
  if (!r) return null
  return (
    <div role="status" className={r.ok ? 'result ok' : 'result bad'}>
      {r.ok ? (
        <>
          Done{r.filledOut !== undefined ? `: ${qty(r.filledOut, 6)}` : ''}. Tx <code>{shortHash(r.hash ?? '')}</code>
          {mock ? ' (mock hash, no chain)' : ''}
        </>
      ) : (
        <>Blocked: {r.error}</>
      )}
    </div>
  )
}

export function MintRedeem({ sym, onSym }: { sym: string; onSym: (s: string) => void }) {
  const { engine, state } = useMarket()
  const [mintAmt, setMintAmt] = useState('1000')
  const [redeemAmt, setRedeemAmt] = useState('1')
  const [rf, setRf] = useState<TradeResult | null>(null)
  const [rm, setRm] = useState<TradeResult | null>(null)
  const [rr, setRr] = useState<TradeResult | null>(null)
  const m = state.markets.find((x) => x.sym === sym)
  const open = m?.sessionOpen ?? true
  const price = m?.refPriceUsd ?? 0
  const held = state.wallet.tokens[sym] ?? 0
  const mintN = Number(mintAmt)
  const redeemN = Number(redeemAmt)
  const mock = state.mode === 'mock'

  return (
    <section aria-label="Mint and redeem">
      <p className="sub">
        The tokenization flow: <strong>1</strong> get test money, <strong>2</strong> mint a stock token from the issuer at the
        oracle price, <strong>3</strong> trade or provide liquidity in the pools, <strong>4</strong> redeem back to tUSDC.
        Mint and redeem (the primary market) only work while the US session is open. The pools (the secondary market) never
        close.
      </p>

      <div className="twocol">
        <div className="panel">
          <h2>1. Test money</h2>
          <p>
            tUSDC balance: <strong>{usd(state.wallet.usdc, 2)}</strong>
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void engine?.faucet().then(setRf)
            }}
          >
            Faucet: +10,000 tUSDC
          </button>
          <Result r={rf} mock={mock} />
          <p className="sub">tUSDC is a mock stablecoin with no value. Wallet: {state.wallet.address || 'n/a'}</p>
        </div>

        <div className="panel">
          <h2>Primary market</h2>
          <label className="field">
            Stock
            <select value={sym} onChange={(e) => onSym(e.target.value)}>
              {(engine?.syms ?? []).map((s) => (
                <option key={s} value={s}>
                  t{s}
                </option>
              ))}
            </select>
          </label>
          <p>
            Status:{' '}
            <strong className={open ? undefined : 'surcharge'}>{open ? 'OPEN' : 'CLOSED'}</strong>. Oracle price {usd(price, 2)}.
          </p>
          {!open && (
            <p className="why-box">
              Primary market closed: the issuer needs a live stock price to mint or redeem safely, so it pauses with the US
              session, as some real issuers do over weekends. The secondary pools keep trading because anyone can swap tokens
              against them, but without a reference the hook can only charge its base fee.
            </p>
          )}
        </div>
      </div>

      <div className="twocol">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void engine?.mint(sym, mintN).then(setRm)
          }}
        >
          <h2>2. Mint t{sym}</h2>
          <label className="field">
            tUSDC to pay
            <input type="number" min="0" step="any" value={mintAmt} onChange={(e) => setMintAmt(e.target.value)} />
          </label>
          <p>
            You receive about <strong>{price > 0 && mintN > 0 ? qty((mintN * (1 - state.issuerFeeBps / 1e4)) / price, 6) : '0'}</strong> t{sym} at the
            oracle price after the issuer fee ({state.issuerFeeBps} bps). No pool fee.
          </p>
          <button type="submit" className="primary" disabled={!open || !(mintN > 0)}>
            Mint
          </button>
          <Result r={rm} mock={mock} />
        </form>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void engine?.redeem(sym, redeemN).then(setRr)
          }}
        >
          <h2>4. Redeem t{sym}</h2>
          <label className="field">
            t{sym} to redeem (you hold {qty(held)})
            <input type="number" min="0" step="any" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
          </label>
          <p>
            You receive about <strong>{price > 0 && redeemN > 0 ? usd(redeemN * price * (1 - state.issuerFeeBps / 1e4), 2) : '$0.00'}</strong> tUSDC after
            the issuer fee ({state.issuerFeeBps} bps).
          </p>
          <button type="submit" className="primary" disabled={!open || !(redeemN > 0)}>
            Redeem
          </button>
          <Result r={rr} mock={mock} />
        </form>
      </div>

      <h2>Proof of reserve</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th className="num">Supply</th>
              <th className="num">Supply value</th>
              <th className="num">tUSDC reserve</th>
              <th className="num">Backing</th>
              <th>Fully backed</th>
            </tr>
          </thead>
          <tbody>
            {state.reserves.map((r) => (
              <tr key={r.sym}>
                <td>t{r.sym}</td>
                <td className="num">{qty(r.supply, 2)}</td>
                <td className="num">{usd(r.supplyValueUsd)}</td>
                <td className="num">{usd(r.usdcReserve)}</td>
                <td className="num">{(r.backingRatio * 100).toFixed(1)}%</td>
                <td>{r.fullyBacked ? 'yes' : 'NO'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caveat">
        {mock
          ? 'Mock: the issuer holds tUSDC against the token supply, valued at the oracle price. The ratio drifts as prices move, because the reserve is cash and the supply value is not. A real tokenized stock is backed by shares a broker holds, verified off-chain.'
          : 'Anvil: reserve and supply value come from StockIssuer.proofOfReserve (tUSDC the issuer holds against supply x oracle price, plus a shared buffer). It is a cash reserve in a test contract, not custody of real shares.'}
      </p>
    </section>
  )
}
