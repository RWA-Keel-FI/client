# Keel client

The web app for **Keel**, a Uniswap v4 hook that sets a swap fee from how far a tokenized-stock pool has drifted from the stock's real price. Part of three repos meant to be checked out side by side:
[`contracts`](https://github.com/RWA-Keel-FI/contracts) (the hook, oracle and tokens, with the deployed Arc Testnet addresses), [`server`](https://github.com/RWA-Keel-FI/server) (Chainlink CRE price workflow, backtest, deploy scripts), [`client`](https://github.com/RWA-Keel-FI/client) (this one).

> **Test tokens only.** The stock token (`tTSLA`) is a mock minted by a mock issuer. Nothing here is a real security or has value.

## What it is

React 19 + Vite + TypeScript, with `wagmi` and `viem` for the chain and WalletConnect for wallets. It targets **Arc Testnet** (chain id 5042002). It reads everything from the chain, and it shows a "not deployed yet" state when there is no deployment instead of showing placeholder numbers.

- `/` is a landing page that explains the idea.
- `/app` is the dapp.

| Tab | What it does |
|---|---|
| Markets | Pool price against the oracle reference price, the reference's age, the current fee and the deviation. |
| Trade | Swap `tTSLA` and USDC through `SwapRouter` against the hook pool. Shows the fee the hook will charge before you sign. |
| Mint & redeem | Mint and redeem `tTSLA` against USDC through the mock `StockIssuer`. Only open while the oracle price is fresh and the session is open. |
| Liquidity | Add and remove liquidity in the hook pool or the static-fee control pool through `LiquidityRouter`. |
| Flows | Diagram of how a price report, a swap and the fee fit together. |
| Fee events | Recent `FeeSet` events from the hook: the fee charged on each swap, the base fee, the deviation and whether the surcharge was armed. |
| Backtest | A **historical** replay of real Ondo tokenized-stock swaps on Ethereum against the fee rule (`results.json` from the `server` repo). It is labelled as a backtest, not live data. |

## Run it

```bash
pnpm install
cp .env.example .env     # set VITE_WALLETCONNECT_PROJECT_ID
pnpm dev                 # http://localhost:5173 (runs sync-deployments first)
pnpm build               # tsc + vite build
pnpm lint
```

A WalletConnect project id is free from <https://dashboard.reown.com>. Without one the app still loads, shows a message, and only injected wallets such as MetaMask are offered. The connect button can add and switch to Arc Testnet in your wallet. Arc's gas token is USDC, so you need Arc testnet USDC from <https://faucet.circle.com>.

### Where addresses come from

`pnpm sync-deployments` (it also runs before `dev` and `build`) copies `../deployments/arc-testnet.json`, `../deployments/abi/` and `../server/backtest/results.json` into `public/`. The `deployments/` folder is written by `server/scripts/deploy-arc.sh` and sits next to the three repos:

```
parent/
  client/   contracts/   server/   deployments/
```

If `arc-testnet.json` is missing, the app renders the "not deployed yet" state. The deployed addresses are listed in the [`contracts` README](https://github.com/RWA-Keel-FI/contracts#deployment-arc-testnet-chain-id-5042002).

### Environment variables

| Variable | Meaning |
|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect (Reown) project id. |
| `VITE_ARC_RPC_URL` | Optional RPC override, for example a local fork of Arc. Default is the public Arc RPC, which rate-limits. |
| `VITE_DEPLOYMENT` | Optional deployment name, default `arc-testnet`. |
| `VITE_POLL_MS` | Optional polling interval for chain reads. |
| `VITE_LOGS_LOOKBACK`, `VITE_LOG_CHUNK` | Optional block range settings for reading `FeeSet` events. |

`.env` is gitignored. Only `.env.example` is committed, and no private key ever goes in the client.

## Status

- The wallet, chain, trade, mint and liquidity code is written and typechecks (`tsc -b` passes).
- It has **not** been exercised end to end with a real wallet signing real transactions on Arc. The on-chain demo swaps on the deployment were sent with scripts, not through this app.
- The oracle's price is stale until the Chainlink CRE workflow in the `server` repo is deployed and writing, so the live fee will read as the base fee (30 bps) until then. The hook does that on purpose when its reference is stale.
- Arc Testnet's public RPC rate-limits (HTTP 429). The app batches reads and polls slowly. For heavier use, set `VITE_ARC_RPC_URL` to a dedicated endpoint.
