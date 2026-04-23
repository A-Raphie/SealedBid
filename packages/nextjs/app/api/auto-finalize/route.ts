import { NextResponse } from "next/server";
import { ethers } from "ethers";
import AuctionFactoryABI from "~~/contracts/AuctionFactory.abi.json";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { TARGET_ACTIVE, TEMPLATES, pickRandom } from "~~/lib/auction-templates";
import { decryptAndSettle } from "~~/lib/decrypt-and-settle";
import { AUCTION_DURATION, FACTORY_ADDRESS, getDeployerWallet, getSettleProvider } from "~~/lib/rpc-config";
import { getSettleState, setSettleDone, setSettlePending } from "~~/lib/settle-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!FACTORY_ADDRESS) {
      return NextResponse.json({ error: "Missing config" }, { status: 500 });
    }

    const provider = await getSettleProvider();
    const wallet = getDeployerWallet(provider);
    const factoryRead = new ethers.Contract(FACTORY_ADDRESS, AuctionFactoryABI as any[], provider);
    const factoryWrite = new ethers.Contract(FACTORY_ADDRESS, AuctionFactoryABI as any[], wallet);

    const allAddresses: string[] = await factoryRead.getAllAuctions();
    const now = Math.floor(Date.now() / 1000);
    const results: string[] = [];

    type AuctionInfo = { addr: string; status: number; deadline: number; bidderCount: number };
    const auctionInfos: AuctionInfo[] = [];

    const BATCH = 4;
    for (let i = 0; i < allAddresses.length; i += BATCH) {
      const batch = allAddresses.slice(i, i + BATCH);
      const infos = await Promise.allSettled(
        batch.map(async addr => {
          const info = await factoryRead.getAuctionInfo(addr);
          return {
            addr,
            status: Number(info.status),
            deadline: Number(info.deadline),
            bidderCount: Number(info.bidderCount),
          };
        }),
      );

      for (const info of infos) {
        if (info.status === "fulfilled") auctionInfos.push(info.value);
      }

      if (i + BATCH < allAddresses.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    for (const info of auctionInfos) {
      const { addr, status, deadline, bidderCount } = info;

      if (status !== 0) continue;
      if (deadline === 0 || deadline >= now) continue;
      if (bidderCount === 0) continue;

      try {
        const auction = new ethers.Contract(addr, SealedBidAuctionABI as any[], wallet);
        const tx = await auction.endAuction();
        await tx.wait();
        results.push(`Ended: ${addr.slice(0, 10)}... (${bidderCount} bids) — ${tx.hash.slice(0, 10)}`);

        await new Promise(r => setTimeout(r, 2000));

        const settleResult = await decryptAndSettle(addr, wallet, provider);
        if (settleResult) {
          results.push(`Settled: ${settleResult.winnerAddr.slice(0, 10)}... (${settleResult.winningBid} wei)`);
        }
      } catch (e: any) {
        results.push(`FAIL end ${addr.slice(0, 10)}: ${e.message?.slice(0, 60)}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    for (const info of auctionInfos) {
      if (info.status !== 1) continue;

      const cached = getSettleState(info.addr);
      if (cached?.status === "pending") {
        results.push(`Skipping ${info.addr.slice(0, 10)}... (already being settled)`);
        continue;
      }

      try {
        setSettlePending(info.addr, "Auto-settling...");
        const settleResult = await decryptAndSettle(info.addr, wallet, provider);
        if (settleResult) {
          setSettleDone(info.addr, settleResult.winnerAddr, String(settleResult.winningBid));
          results.push(`Auto-settled: ${info.addr.slice(0, 10)}... → ${settleResult.winnerAddr.slice(0, 10)}...`);
        }
      } catch (e: any) {
        results.push(`FAIL settle ${info.addr.slice(0, 10)}: ${e.message?.slice(0, 60)}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    const currentActive = auctionInfos.filter(a => a.status === 0).length;
    const toCreate = Math.min(2, Math.max(0, TARGET_ACTIVE - currentActive));

    if (toCreate > 0) {
      const templates = pickRandom(TEMPLATES, toCreate);

      for (let i = 0; i < templates.length; i++) {
        const t = templates[i];

        if (i > 0) await new Promise(r => setTimeout(r, 4000));

        try {
          const itemURI = JSON.stringify(t.meta);
          const tx = await factoryWrite.createAuction(
            itemURI,
            t.title,
            t.description,
            ethers.ZeroAddress,
            AUCTION_DURATION,
            t.category,
            ethers.ZeroAddress,
            0,
          );
          const receipt = await tx.wait();
          results.push(`Created: ${t.title} (${AUCTION_DURATION}s) — ${receipt.hash.slice(0, 10)}`);
        } catch (e: any) {
          results.push(`FAIL create: ${t.title} — ${e.message?.slice(0, 80)}`);
        }
      }
    }

    return NextResponse.json({
      processed: results.length,
      activeCount: auctionInfos.filter(a => a.status === 0).length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
