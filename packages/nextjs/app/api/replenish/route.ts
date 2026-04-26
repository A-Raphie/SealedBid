import { NextResponse } from "next/server";
import { ethers } from "ethers";
import AuctionFactoryABI from "~~/contracts/AuctionFactory.abi.json";
import { TARGET_ACTIVE, TEMPLATES, pickRandom } from "~~/lib/auction-templates";
import { AUCTION_DURATION, FACTORY_ADDRESS, getDeployerWallet, getSettleProvider } from "~~/lib/rpc-config";

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

    let activeCount = 0;
    const BATCH = 4;
    for (let i = 0; i < allAddresses.length; i += BATCH) {
      const batch = allAddresses.slice(i, i + BATCH);
      const infos = await Promise.allSettled(
        batch.map(async addr => {
          const info = await factoryRead.getAuctionInfo(addr);
          return Number(info.status);
        }),
      );
      for (const info of infos) {
        if (info.status === "fulfilled" && info.value === 0) activeCount++;
      }
      if (i + BATCH < allAddresses.length) await new Promise(r => setTimeout(r, 300));
    }

    const toCreate = Math.max(0, TARGET_ACTIVE - activeCount);
    if (toCreate === 0) {
      return NextResponse.json({ activeCount, created: 0 });
    }

    const templates = pickRandom(TEMPLATES, toCreate);
    const results: string[] = [];

    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      if (i > 0) await new Promise(r => setTimeout(r, 3000));
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
        results.push(`${t.title} — ${receipt.hash.slice(0, 10)}`);
      } catch (e: any) {
        results.push(`FAIL: ${t.title} — ${e.message?.slice(0, 80)}`);
      }
    }

    return NextResponse.json({ activeCount, created: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
