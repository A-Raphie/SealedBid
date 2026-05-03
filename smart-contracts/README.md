# Smart Contracts

SealedBid auction contracts built on Zama's fhEVM (Solidity 0.8.27, evmVersion: cancun).

## Contracts

| File | Description |
|---|---|
| [`SealedBidAuction.sol`](contracts/SealedBidAuction.sol) | Auction logic — encrypted bidding via FHE, timer-on-first-bid, homomorphic winner comparison, settle |
| [`AuctionFactory.sol`](contracts/AuctionFactory.sol) | Factory — creates/tracks auctions, pagination, info queries |

## Deployment

**Sepolia:** `0xf6aACE498919826cFDbC8C3C125D6FCE161Ce39f` ([Etherscan](https://sepolia.etherscan.io/address/0xf6aACE498919826cFDbC8C3C125D6FCE161Ce39f))

Deployment artifact: [`AuctionFactory.json`](AuctionFactory.json)

## Key Functions

```
function placeBid(einput64 encryptedBid, bytes inputProof) external  // Submit encrypted bid
function endAuction() external                                       // Run FHE tournament, allow decrypt
function settleAuction(address winner, uint64 winningBid) external   // Reveal winner
function cancelAuction() external                                    // Creator cancels (pre-bid only)
```

## Tests

19 tests passing (`pnpm hardhat:test`):

```
contract: SealedBidAuction
  ✓ should create auction with correct params
  ✓ should place encrypted bid
  ✓ should track bidder count
  ✓ should start timer on first bid
  ✓ should reject bids below minimum
  ✓ should reject bids after deadline
  ✓ should end auction after deadline
  ✓ should compute results on end
  ✓ should allow multiple bids from same address (keeps highest)
  ✓ should correctly determine winner via FHE comparison
  ... (19 total)
```
