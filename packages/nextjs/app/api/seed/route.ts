import { NextResponse } from "next/server";
import { ethers } from "ethers";
import AuctionFactoryABI from "~~/contracts/AuctionFactory.abi.json";
import { TEMPLATES, pickRandom } from "~~/lib/auction-templates";
import { AUCTION_DURATION, FACTORY_ADDRESS, getDeployerWallet, getSettleProvider } from "~~/lib/rpc-config";

export async function GET() {
  try {
    if (!FACTORY_ADDRESS) {
      return NextResponse.json({ error: "Missing FACTORY_ADDRESS" }, { status: 500 });
    }

    const provider = await getSettleProvider();
    const wallet = getDeployerWallet(provider);
    const factory = new ethers.Contract(FACTORY_ADDRESS, AuctionFactoryABI as any[], wallet);

    const allAddresses: string[] = await factory.getAllAuctions();

    if (allAddresses.length > 0) {
      return NextResponse.json({
        totalAuctions: allAddresses.length,
        created: 0,
        message: "Auctions exist — use auto-finalize for lifecycle management",
      });
    }

    const templates = pickRandom(TEMPLATES, 8);
    const results: string[] = [];

    for (const t of templates) {
      try {
        const itemURI = JSON.stringify(t.meta);
        const tx = await factory.createAuction(
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
        results.push(`${t.title} (${AUCTION_DURATION}s) — tx: ${receipt.hash.slice(0, 10)}...`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e: any) {
        results.push(`FAILED: ${t.title} — ${e.message?.slice(0, 80)}`);
      }
    }

    return NextResponse.json({
      totalAuctions: 8,
      created: 8,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
