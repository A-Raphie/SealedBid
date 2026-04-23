# AGENTS.md

## Repo Structure

pnpm monorepo with 3 packages:

- **`packages/hardhat`** — Solidity contracts (SealedBidAuction, AuctionFactory). A git submodule from `zama-ai/fhevm-hardhat-template`. Uses Hardhat + hardhat-deploy + typechain.
- **`packages/fhevm-sdk`** — Custom FHE SDK wrapper. ESM (`"type": "module"`), exports sub-paths (`react`, `core`, `storage`, `types`). Tests use Vitest with jsdom.
- **`packages/nextjs`** — Next.js 15 + React 19 frontend. wagmi v2, RainbowKit, ethers v6 (reads only), Tailwind CSS 4.

## Commands

```bash
# Install (runs sdk:build as preinstall, patches node-tkms as postinstall)
pnpm install

# Contracts — compile, test, deploy
pnpm hardhat:compile          # also runs typechain via postcompile
pnpm hardhat:test             # mocha/chai tests in packages/hardhat/test/
pnpm hardhat:deploy           # deploy to localhost
pnpm hardhat:deploy:sepolia   # deploy to Sepolia

# After deploying, generate TS ABI files for the frontend:
pnpm generate                 # scripts/generateTsAbis.ts → packages/nextjs/contracts/deployedContracts.ts

# Full local deploy flow:
pnpm chain                    # start hardhat node
pnpm deploy:localhost         # deploy + generate

# Frontend
pnpm start                    # next dev (packages/nextjs)

# Lint & format
pnpm lint                     # next:lint && hardhat:lint
pnpm format                   # prettier across nextjs + hardhat

# fhevm-sdk
pnpm sdk:build                # tsc build
pnpm sdk:test                 # vitest run --coverage
pnpm sdk:watch                # tsc --watch

# Typecheck (frontend only)
cd packages/nextjs && pnpm check-types
```

## Critical Workflows

### Deploy → Generate cycle

Deploying contracts changes `packages/hardhat/deployments/`. You must run `pnpm generate` after deploy to update `packages/nextjs/contracts/deployedContracts.ts`. The `deploy:localhost` and `deploy:sepolia` root scripts include this step automatically.

### fhevm-sdk must build before install

`preinstall` runs `pnpm sdk:build`. If the SDK fails to build, the entire install breaks. The SDK must be built before `nextjs` can import it (`@fhevm-sdk` is a `workspace:*` dependency).

### node-tkms patch

`postinstall` runs `scripts/patch-node-tkms.sh` which patches `node-tkms` for browser compatibility (replaces `require('util')` with `globalThis`). Without this, the Next.js client bundle breaks.

## Environment

`packages/nextjs/.env.local` is required for full functionality:

```
NEXT_PUBLIC_FACTORY_ADDRESS=0xf6aACE498919826cFDbC8C3C125D6FCE161Ce39f
DEPLOYER_MNEMONIC=your twelve word mnemonic phrase here
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_key
NEXT_PUBLIC_IMGBB_KEY=your_imgbb_key
```

Hardhat uses `vars` for secrets (run `npx hardhat vars setup`). Key vars: `MNEMONIC`, `INFURA_API_KEY`, `ETHERSCAN_API_KEY`.

## Testing

- **Hardhat tests**: `pnpm hardhat:test` — mocha + chai + chai-as-promised. Tests live in `packages/hardhat/test/`. Uses `@fhevm/mock-utils` for FHE simulation locally.
- **fhevm-sdk tests**: `pnpm sdk:test` — Vitest with jsdom + fake-indexeddb. Tests in `packages/fhevm-sdk/test/`.
- **No frontend tests** exist currently.

## Architecture Gotchas

- **`packages/hardhat` is a git submodule** — it tracks `zama-ai/fhevm-hardhat-template` main branch. Changes to contracts are in a separate repo.
- **Solidity version is 0.8.27** with `evmVersion: "cancun"` and optimizer enabled (800 runs).
- **ethers signer vs wagmi**: Browser writes must use wagmi's `writeContractAsync`, not ethers signer. ethers `JsonRpcProvider` is for reads only.
- **FallbackProvider fails in browsers** — the app uses `JsonRpcProvider` with manual RPC fallback (Infura → Alchemy → PublicNode → …).
- **FHE decrypt takes ~50-60 seconds** — not instant. UI must account for this delay.
- **`Promise.all` fails on FHE contracts** — some view functions revert on certain auction states. Use `Promise.allSettled()`.
- **wagmi v2 `isConnected` is unreliable** — check `!!address` instead.
- **1rpc.io doesn't work for FHE SDK** — `createInstance()` requires Infura or Alchemy.
- **Next.js config**: `serverExternalPackages` includes `node-tfhe`, `node-tkms`, `@zama-fhe/relayer-sdk`. Webpack fallbacks empty `fs`, `net`, `tls`, `child_process`, `worker_threads` for client bundle.

## Linting Conventions

- Hardhat: ESLint (typescript-eslint recommended) + solhint + prettier. Unused vars prefixed with `_` are allowed.
- Next.js: `next/core-web-vitals` + `prettier`. `@typescript-eslint/no-explicit-any` and `@typescript-eslint/ban-ts-comment` are off.
