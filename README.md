# DeviationFee app

Vite + React + TypeScript dashboard for the DeviationFee hook. Test tokens only, local anvil only.

Pages: Markets, Trade, Mint & redeem, Liquidity, Flows, plus the older Fee curve, Swap log and Backtest tabs.

## Run

```
pnpm install
pnpm dev          # http://localhost:5173, runs sync-deployments first
pnpm build        # tsc + vite build
pnpm lint
```

## Two data sources

The toggle at the top of every market page switches between them (remembered in localStorage).

- **Mock (browser)**: the default. A simulation in `src/lib/market/mockEngine.ts` with invented prices, retail flow and an arbitrageur, on constant-product pools. Needs nothing else. It has controls for play/pause, news shocks and an open/closed session.
- **Anvil (local chain)**: reads and writes the deployment in `../deployments/local.json` through viem (`src/lib/market/chainEngine.ts`).

For anvil mode: start anvil, deploy, then `pnpm sync-deployments` (also runs before `dev` and `build`). It copies
`../deployments/local.json`, `../deployments/abi/` and `../server/sim/out/summary.json` into `public/`. If they are missing the app stays in mock mode.

## Environment variables

| Variable | Meaning |
|---|---|
| `VITE_ENGINE` | `chain` to start in anvil mode (default `mock`) |
| `VITE_RPC_URL` | override the RPC in `local.json` |
| `VITE_RETAIL_PK` | signer key. Defaults to anvil account #5, the deployment's `retail` account. |
| `VITE_FROM_BLOCKS` | how many blocks of history the Flows page reads (default 5000) |

**Keys.** The default key is one of anvil's published development keys. It is public, it is the same on every anvil install, and it holds only test tokens. Never put a real key in a `VITE_` variable: Vite embeds them in the browser bundle.

## What is verified

See the final report of the frontend task. In short: mock mode and anvil mode were both exercised in a headless browser (trade, mint, add and remove liquidity, flows). Fees earned by a position are not read back from the chain.
