# SealedBid — Confidential Sealed-Bid Auctions on fhEVM

A decentralized sealed-bid auction platform where bids are **encrypted using Fully Homomorphic Encryption (FHE)**. Nobody — not even the contract creator — can see individual bids. The winner is determined through **homomorphic comparison** on encrypted data, and only the winning bid is ever decrypted.

Built for the [Zama Developer Program](https://www.zama.ai/) Builder Track.

## Demo

[3-min video demo](https://www.loom.com/share/52f9444489b34ff8a1584093291b1af2)

## How It Works

Traditional on-chain auctions are transparent — anyone can see all bids, enabling sniping and collusion. SealedBid uses Zama's fhEVM to keep bids private:

```
1. User enters bid → encrypted client-side via fhevm SDK
2. Encrypted bid (euint64) submitted on-chain — nobody can read it
3. First bid starts a countdown timer (default: 10 seconds)
4. Timer expires → agentic wallet calls endAuction() (FHE tournament runs on-chain)
5. Server-side FHE decrypt reveals only the winner + winning bid
6. All other bids stay private forever
```

### FHE Tournament

The `SealedBidAuction` contract uses `FHE.gt()` (greater-than) and `FHE.select()` to find the highest bid **without decrypting any individual bid**:

```solidity
for (uint256 i = 1; i < bidders.length; i++) {
    euint64 challenger = encryptedBids[bidders[i]];
    ebool isGreater = FHE.gt(challenger, currentMax);
    currentMax = FHE.select(isGreater, challenger, currentMax);
    currentWinnerIdx = FHE.select(isGreater, idxEnc, currentWinnerIdx);
}
```

## Why FHE?

| Problem | Solution |
|---------|----------|
| On-chain bids are public → bid sniping | Bids encrypted client-side, stored as `euint64` |
| Auctioneers can peek at bids | Even the contract creator cannot decrypt individual bids |
| Trusted third party needed for sealed bids | FHE tournament computes winner on encrypted data — no trust required |
| Collusion between bidders | Impossible — bid values never visible until reveal |

**Real-world use cases:** procurement (government contracts), NFT art sales, real estate bidding, freelance job auctions, commodity trading.

## Features

- **Encrypted bids** via fhEVM — fully private until reveal
- **FHE tournament** determines winner without decrypting bids
- **Agentic wallet** — server-side auto-decrypt and settle, users never sign compute transactions
- **Timer-on-first-bid** — countdown starts when first bid is placed, not at creation
- **5 categories** — NFT Art, Procurement, Real Estate, Freelance, Commodity
- **Image upload** via imgbb CDN with client-side compression
- **Create Auction modal** — duration picker with seconds/minutes/hours/days
- **Cancel Auction** — creators can cancel before any bids
- **"My Encrypted Bids" tab** — paginated view of auctions you've bid on, persisted via localStorage
- **Viewer-specific UX** — winner (green + confetti), loser (red), non-bidder (neutral)
- **Adaptive splash screen** — 1.5s minimum, dismisses when data ready, 4s maximum
- **Server-side cache** — `/api/auctions` caches on-chain data with 60s TTL, reduces RPC calls by ~8×
- **Server-side FHE encryption fallback** — `/api/encrypt` when browser FHE relayer is unavailable
- **Auto-replenishing** — maintains 8 active auctions from 12 templates
- **Real-time countdown** timers with seconds
- **No burner wallet** — users connect their own wallet (MetaMask, WalletConnect, Coinbase, etc.)
- **RPC fallback** — Infura → Alchemy → PublicNode → 1RPC → rpc.sepolia.org → DRPC
- **OpenSea-inspired** dark UI with Zama theme (navy + gold)
- **Mobile-responsive** layout

## Tech Stack

| Layer | Technology |
|-------|-----------|
| FHE | [Zama fhEVM](https://docs.zama.ai/fhevm) — Fully Homomorphic Encryption on EVM |
| Smart Contracts | Solidity 0.8.27 — SealedBidAuction + AuctionFactory |
| Frontend | Next.js 15, React 19, TypeScript |
| Wallet | wagmi v2, RainbowKit (MetaMask, WalletConnect, Coinbase, Ledger) |
| Encryption SDK | fhevm SDK (`packages/fhevm-sdk`) |
| Contract Reads | ethers.js v6 (JsonRpcProvider) |
| Styling | Tailwind CSS 4, custom Zama theme |
| Network | Sepolia testnet |

## Smart Contracts

### AuctionFactory ([Verified on Etherscan](https://sepolia.etherscan.io/address/0xf6aACE498919826cFDbC8C3C125D6FCE161Ce39f#code))

Creates and tracks all auction instances.

```solidity
function createAuction(string itemURI, string title, string description,
                       address paymentToken, uint256 durationSeconds,
                       uint8 category, address nftContract, uint256 nftTokenId)
    external returns (address);
function getAllAuctions() external view returns (address[]);
function getAuctionInfo(address auction) external view returns (AuctionInfo);
function getAuctionCount() external view returns (uint256);
```

### SealedBidAuction

Core auction contract with FHE bid storage and tournament.

```solidity
function placeBid(externalEuint64 inputBid, bytes calldata inputProof) external onlyActive;
function endAuction() external;                      // Runs FHE tournament, allows all bidders to decrypt
function settleAuction(address winner, uint64 winningBid) external onlyCreator;
function cancelAuction() external onlyCreator;       // Cancel before any bids
function winningBid() external view returns (uint64); // Post-settle winner amount
```

**Auction lifecycle:** Active (status 0) → Ended (status 1, FHE computed) → Settled (status 2)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Browser   │     │  Next.js API │     │  Sepolia (fhEVM) │
│             │     │              │     │                  │
│  fhevm SDK  │────▶│ /api/encrypt │     │  AuctionFactory  │
│  encrypt    │     │  (fallback)  │     │       │          │
│  bid        │     │              │     │  SealedBidAuction│
│             │     │ /api/auctions│     │   (euint64 bids) │
│  wagmi      │────▶│  (60s cache) │────▶│  placeBid()      │
│  writeContract    │              │     │  endAuction()    │
│             │     │  Agentic     │     │  settleAuction() │
│             │     │  Wallet      │────▶│                  │
│             │     │  (HDNode)    │     │  FHE.gt()        │
│  polls      │◀────│  decrypt     │◀────│  FHE.select()    │
│  results    │     │  + settle    │     │  FHE.allow()     │
└─────────────┘     └──────────────┘     └──────────────────┘
```

**Key design decisions:**

- **Agentic wallet pattern** — A server-side HDNodeWallet (derived from a mnemonic) handles `endAuction()` and `settleAuction()` automatically. Users only sign their encrypted bid — the rest is trustless and automatic.
- **Timer-on-first-bid** — The countdown starts at 0 and is set when the first bid is placed. This eliminates the need for constant auction restarts and extends deployer wallet longevity from ~23 hours to ~91 days.
- **`FHE.allow()` for all bidders** — `endAuction()` grants decryption access to every bidder, enabling server-side winner reveal without per-user signatures.

## Getting Started

### Prerequisites

- Node.js v18+
- pnpm
- MetaMask with Sepolia ETH

### Installation

```bash
git clone <repository-url>
cd SealedBid
pnpm install
```

### Configuration

Create `packages/nextjs/.env.local`:

```env
NEXT_PUBLIC_FACTORY_ADDRESS=0xf6aACE498919826cFDbC8C3C125D6FCE161Ce39f
DEPLOYER_MNEMONIC=your twelve word mnemonic phrase here
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_key
NEXT_PUBLIC_IMGBB_KEY=your_imgbb_key
```

### Run Locally

```bash
cd packages/nextjs
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Seed Auctions

```bash
curl http://localhost:3000/api/seed
```

Creates 8 sample auctions with 10-second durations from pre-built templates.

### Deploy Contracts (Sepolia)

```bash
cd packages/hardhat
npx hardhat deploy --network sepolia
```

### Run Tests

```bash
cd packages/hardhat
npx hardhat test
```

19 tests covering bid placement, FHE tournament, auction lifecycle, cancel, and edge cases.

## Project Structure

```
SealedBid/
├── packages/
│   ├── hardhat/
│   │   ├── contracts/
│   │   │   ├── SealedBidAuction.sol          # FHE auction contract
│   │   │   └── AuctionFactory.sol            # Factory pattern
│   │   ├── test/SealedBidAuction.ts          # 19 tests
│   │   ├── deploy/deploy.ts                  # Hardhat deploy script
│   │   └── scripts/seed-auctions.ts          # Standalone seeder
│   ├── fhevm-sdk/                            # Custom FHE SDK wrapper
│   │   └── src/
│   │       ├── react/
│   │       │   ├── useFhevm.tsx              # FHE instance management
│   │       │   ├── useFHEEncryption.ts       # Encryption hook
│   │       │   └── useFHEDecrypt.ts          # Decryption hook
│   │       └── internal/
│   │           ├── fhevm.ts                  # Instance creation
│   │           └── RelayerSDKLoader.ts       # Relayer SDK loader
│   └── nextjs/
│       ├── app/
│       │   ├── _components/SealedBidApp.tsx  # Main UI (cards, detail, modals)
│       │   ├── error.tsx                     # Error boundary
│       │   └── api/
│       │       ├── auctions/route.ts        # Cached auction data (60s TTL)
│       │       ├── encrypt/route.ts         # Server-side FHE encryption fallback
│       │       ├── replenish/route.ts       # Parallel auction creation
│       │       ├── seed/route.ts            # Initial auction seeding
│       │       ├── auto-finalize/route.ts   # End + settle + replenish
│       │       └── trigger-settle/route.ts  # Single-auction settle
│       ├── hooks/sealedbid/
│       │   ├── useSealedBidAuction.ts        # Auction reads/writes/FHE
│       │   └── useAuctionFactory.ts          # Factory interactions
│       ├── lib/
│       │   ├── rpc-config.ts                 # RPC URLs, provider singletons
│       │   ├── decrypt-and-settle.ts         # FHE decrypt + settle logic
│       │   ├── settle-cache.ts               # In-memory settle state
│       │   ├── auction-templates.ts          # 12 templates, TARGET_ACTIVE=8
│       │   └── auction-metadata.ts           # Types, parseItemURI, buildItemURI
│       ├── contracts/                        # ABIs + deployed addresses
│       └── styles/globals.css                # Zama theme + animations
```

## Auto-Replenish System

The app maintains **8 active auctions** at all times:

- **`/api/seed`** — Creates 8 auctions with 10-second durations when none exist.
- **`/api/auctions`** — Server-side cache of all auction data. 60s TTL, serves stale cache on error. Frontend polls every 10-30s instead of hitting RPC directly.
- **`/api/encrypt`** — Server-side FHE encryption fallback when browser FHE relayer is unavailable. Uses cached FHE instance.
- **`/api/replenish`** — Creates up to 8 auctions in parallel with explicit nonces, no confirmation wait.
- **`/api/auto-finalize`** — Ends expired auctions with bids, decrypts + settles via agentic wallet, replenishes up to 8. Triggered every 90 seconds from the frontend.
- **`/api/trigger-settle`** — Non-blocking single-auction settle endpoint. Auto-triggered silently when auction ends; also called manually via "Check Winner" button. Settle tx is fire-and-forget (no `tx.wait()`) to fit within Vercel's 60s window. Retried every 5s on status transitions or failure.

All server-side operations use an **agentic wallet** (HDNodeWallet from mnemonic) — no user signatures required for `endAuction()` or `settleAuction()`.

## Performance & RPC Optimization

The app is designed to minimize RPC calls and handle unreliable infrastructure:

- **Server-side cache** (`/api/auctions`) — 60s TTL. Frontend reads from cache instead of hitting RPC directly. Serves stale cache on error.
- **Adaptive splash screen** — 1.5s minimum, dismisses when cached data is ready, 4s maximum. Hides loading from the user.
- **Adaptive polling** — When no active auctions exist, polls `/api/auctions` every 10s. When auctions are active, every 30s. Browser factory polls every 60s. Auction detail view polls every 15-30s (faster when nearing deadline).
- **Server-side FHE fallback** — If browser FHE relayer is unavailable, `/api/encrypt` handles encryption server-side using a cached FHE instance.
- **Parallel auction creation** — `/api/replenish` uses explicit nonces to create multiple auctions in a single block, no confirmation wait.

## Key Learnings

- **`FallbackProvider` doesn't work in browsers** — Different RPCs report different chain IDs, causing `NETWORK_ERROR`. Use `JsonRpcProvider` with manual fallback logic instead.
- **wagmi v2's `isConnected` is unreliable** — Can be `false` while `address` is populated during reconnection. Check `!!address` instead.
- **1rpc.io doesn't work for FHE SDK** — The `network` parameter in `createInstance()` requires Infura or Alchemy; 1rpc.io causes a hang.
- **FHE decrypt takes ~40-50 seconds** — Zama's server-side homomorphic decryption is not instant. The full settle flow (end auction + decrypt + settle tx) completes in ~40-50s with auto-retry every 5s.
- **Timer-on-first-bid saves gas** — Instead of restarting auctions every 10 seconds, the timer starts at 0 and is set on first bid. 2 ETH lasts ~91 days instead of ~23 hours.
- **Base64 on-chain is prohibitively expensive** — A 200KB base64 string costs ~3.2M gas. Use external image hosting (imgbb CDN).
- **`ethers` signer doesn't work in browser wallets** — Use wagmi's `writeContractAsync` for writes, ethers `JsonRpcProvider` for reads only.
- **`Promise.all` fails on FHE contracts** — Some view functions revert on certain auction states. Use `Promise.allSettled()` for batch reads.
- **Burner wallets auto-connect on new devices** — `rainbowkitBurnerWallet` from `burner-connector` creates a random wallet and auto-connects without user interaction. Remove for production dApps.
- **Vercel serverless doesn't persist state across cold starts** — In-memory cache only works for warm instances. Use `after()` from `next/server` for background refresh to keep cache warm.
- **Vercel Hobby cron is limited to daily** — Use frontend-triggered API calls for frequent operations like auto-finalize.
- **`after()` from `next/server`** — Keeps serverless function alive for background work after response is sent. Available in Next.js 15+.

## License

This project is licensed under the **BSD-3-Clause-Clear License**. See the [LICENSE](LICENSE) file for details.

---

Built by [Raphie](https://x.com/A_raphie) for the Zama Developer Program.
