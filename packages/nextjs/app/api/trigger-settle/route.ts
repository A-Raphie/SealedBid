import { after } from "next/server";
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { decryptAndSettle, prewarmFHE } from "~~/lib/decrypt-and-settle";
import { getDeployerWallet, getSettleProvider } from "~~/lib/rpc-config";
import {
  canRetry,
  clearSettleEntry,
  getSettleState,
  incrementAttempt,
  setSettleDone,
  setSettlePending,
  setSettleStep,
} from "~~/lib/settle-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const addr = searchParams.get("addr");
    if (!addr || !addr.startsWith("0x")) {
      return NextResponse.json({ error: "Missing addr parameter" }, { status: 400 });
    }

    const cached = getSettleState(addr);
    if (cached?.status === "done") {
      if (cached.winner) {
        return NextResponse.json({ settled: true, winner: cached.winner, winningBid: cached.winningBid });
      }
      if (cached.error && !canRetry(addr)) {
        return NextResponse.json({ error: true, step: cached.error, attempts: cached.attempts });
      }
      clearSettleEntry(addr);
    }
    if (cached?.status === "pending") {
      return NextResponse.json({ pending: true, step: cached.step || "processing", attempts: cached.attempts });
    }

    const provider = await getSettleProvider();
    const wallet = getDeployerWallet(provider);
    const auction = new ethers.Contract(addr, SealedBidAuctionABI as any[], provider);

    const [status, deadline, bidderCount, winner] = await Promise.all([
      auction.status(),
      auction.deadline(),
      auction.getBidderCount(),
      auction.winner(),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const s = Number(status);
    const dl = Number(deadline);
    const bc = Number(bidderCount);

    if (s === 2 || (winner && winner !== ethers.ZeroAddress)) {
      const wb = await auction.winningBid();
      setSettleDone(addr, winner, String(wb));
      return NextResponse.json({ settled: true, winner, winningBid: String(wb) });
    }

    if (s === 0 && dl > 0 && dl <= now && bc > 0) {
      setSettlePending(addr, "Ending auction...");
      prewarmFHE();

      const backgroundWork = async () => {
        try {
          const auctionWrite = new ethers.Contract(addr, SealedBidAuctionABI as any[], wallet);
          setSettleStep(addr, "Submitting endAuction tx...");
          const tx = await auctionWrite.endAuction();
          setSettleStep(addr, "Waiting for endAuction confirmation...");
          await tx.wait();

          setSettleStep(addr, "Auction ended. Starting FHE decryption...");
          const attempt = incrementAttempt(addr);
          setSettleStep(addr, `Decrypting bids (attempt ${attempt})...`);

          const result = await decryptAndSettle(addr, wallet, provider);
          if (result) {
            setSettleDone(addr, result.winnerAddr, String(result.winningBid));
          } else {
            setSettleStep(addr, "Decrypt returned no result — will retry on next poll");
          }
        } catch (e: any) {
          console.error(`trigger-settle background error for ${addr}:`, e.message?.slice(0, 120));
        }
      };

      try { after(backgroundWork); } catch { backgroundWork(); }
      return NextResponse.json({ pending: true, step: "Ending auction..." });
    }

    if (s === 1) {
      const attempt = incrementAttempt(addr);
      setSettleStep(addr, `Decrypting bids (attempt ${attempt})...`);
      prewarmFHE();

      const backgroundWork = async () => {
        try {
          const result = await decryptAndSettle(addr, wallet, provider);
          if (result) {
            setSettleDone(addr, result.winnerAddr, String(result.winningBid));
          } else {
            setSettleStep(addr, "Decrypt returned no result — will retry on next poll");
          }
        } catch (e: any) {
          console.error(`trigger-settle decrypt error for ${addr}:`, e.message?.slice(0, 120));
        }
      };

      try { after(backgroundWork); } catch { backgroundWork(); }
      return NextResponse.json({ pending: true, step: `Decrypting bids (attempt ${attempt})...` });
    }

    return NextResponse.json({ pending: true, status: s, deadline: dl, bidderCount: bc });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
