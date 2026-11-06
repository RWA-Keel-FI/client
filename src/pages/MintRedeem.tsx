import { useState } from 'react'
import { TxStatus } from '../components/Tx.tsx'
import { useTx } from '../lib/useTx.ts'
import { ActionGate } from '../components/WalletButton.tsx'
import { useCanTransact } from '../lib/chain/useArc.ts'
import { ARC_FAUCET } from '../lib/chain/arc.ts'
import { useMarket } from '../lib/market/context.ts'
import { qty, usd } from '../lib/market/format.ts'

export function MintRedeem({ sym, onSym }: { sym: string; onSym: (s: string) => void }) {
  const { engine, state } = useMarket()
  const [mintAmt, setMintAmt] = useState('1000')
  const [redeemAmt, setRedeemAmt] = useState('1')
  const mintTx = useTx()
  const redeemTx = useTx()
  const canTx = useCanTransact()
  const m = state.markets.find((x) => x.sym === sym)
  const open = m?.primaryOpen ?? false
  const price = m?.refPriceUsd ?? 0
  const held = state.wallet.tokens[sym] ?? 0
  const mintN = Number(mintAmt)
  const redeemN = Number(redeemAmt)

  return (
    <section aria-label="Mint and redeem">
      <p className="sub">
        The tokenization flow: <strong>1</strong> get test USDC, <strong>2</strong> mint a stock token from the issuer at the
        oracle price, <strong>3</strong> trade or provide liquidity in the pools, <strong>4</strong> redeem back to USDC.
        Mint and redeem (the primary market) only work while the US session is open. The pools (the secondary market) never
        close.
      </p>

      <div className="twocol">
        <div className="panel">
          <h2>1. Test USDC</h2>
          <p>
            USDC balance: <strong>{canTx ? usd(state.wallet.usdc, 2) : 'connect a wallet'}</strong>
          </p>
          <a className="btnlink" href={ARC_FAUCET} target="_blank" rel="noreferrer">Open the Circle faucet</a>
          <p className="sub">
            Arc Testnet uses USDC for gas as well. The faucet sends test USDC with no value. Your gas balance: {canTx ? `${qty(state.wallet.native, 4)} USDC` : 'n/a'}.
          </p>
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
            <strong className={open ? undefined : 'surcharge'}>{open ? 'OPEN' : 'CLOSED'}</strong>. Oracle price {usd(price, 2)}
            {m ? ` (updated ${m.refAgeSec}s ago${m.stale ? ', stale' : ''})` : ''}.
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
            void mintTx.run((onStep) => engine!.mint(sym, mintN, onStep))
          }}
        >
          <h2>2. Mint t{sym}</h2>
          <label className="field">
            USDC to pay
            <input type="number" min="0" step="any" value={mintAmt} onChange={(e) => setMintAmt(e.target.value)} />
          </label>
          <p>
            You receive about <strong>{price > 0 && mintN > 0 ? qty((mintN * (1 - state.issuerFeeBps / 1e4)) / price, 6) : '0'}</strong> t{sym} at the
            oracle price after the issuer fee ({state.issuerFeeBps} bps). No pool fee.
          </p>
          {canTx ? (
            <button type="submit" className="primary" disabled={!open || !(mintN > 0) || mintTx.busy || mintN > state.wallet.usdc}>
              {mintTx.busy ? 'Confirming...' : 'Mint'}
            </button>
          ) : (
            <ActionGate />
          )}
          {canTx && mintN > state.wallet.usdc && <p role="alert" className="err">Not enough USDC.</p>}
          <TxStatus busy={mintTx.busy} step={mintTx.step} result={mintTx.result} unit={`t${sym}`} verb="Minted" />
        </form>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void redeemTx.run((onStep) => engine!.redeem(sym, redeemN, onStep))
          }}
        >
          <h2>4. Redeem t{sym}</h2>
          <label className="field">
            t{sym} to redeem{canTx ? ` (you hold ${qty(held)})` : ''}
            <input type="number" min="0" step="any" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
          </label>
          <p>
            You receive about <strong>{price > 0 && redeemN > 0 ? usd(redeemN * price * (1 - state.issuerFeeBps / 1e4), 2) : '$0.00'}</strong> USDC after
            the issuer fee ({state.issuerFeeBps} bps).
          </p>
          {canTx ? (
            <button type="submit" className="primary" disabled={!open || !(redeemN > 0) || redeemTx.busy || redeemN > held}>
              {redeemTx.busy ? 'Confirming...' : 'Redeem'}
            </button>
          ) : (
            <ActionGate />
          )}
          {canTx && redeemN > held && <p role="alert" className="err">You do not hold that much t{sym}.</p>}
          <TxStatus busy={redeemTx.busy} step={redeemTx.step} result={redeemTx.result} unit="USDC" verb="Redeemed" />
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
              <th className="num">USDC reserve</th>
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
        Read from StockIssuer.proofOfReserve: the USDC the issuer holds against supply x oracle price, plus a buffer shared between tickers. The ratio drifts as
        prices move, because the reserve is cash and the supply value is not. It is a cash reserve in a test contract, not custody of real shares.
      </p>
    </section>
  )
}
