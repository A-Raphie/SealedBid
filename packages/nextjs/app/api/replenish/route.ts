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
    const recent = allAddresses.slice(-16);

    let activeCount = 0;
    const infos = await Promise.allSettled(
      recent.map(async addr => {
        const info = await factoryRead.getAuctionInfo(addr);
        return Number(info.status);
      }),
    );
    for (const info of infos) {
      if (info.status === "fulfilled" && info.value === 0) activeCount++;
    }

    const toCreate = Math.max(0, TARGET_ACTIVE - activeCount);
    if (toCreate === 0) {
      return NextResponse.json({ activeCount, created: 0 });
    }

    const templates = pickRandom(TEMPLATES, toCreate);
    const nonce = await wallet.getNonce("latest");
    const results: string[] = [];

    const txPromises = templates.map((t, i) => {
      const itemURI = JSON.stringify(t.meta);
      return factoryWrite.createAuction(
        itemURI, t.title, t.description, ethers.ZeroAddress,
        AUCTION_DURATION, t.category, ethers.ZeroAddress, 0,
        { nonce: nonce + i },
      ).then(tx => {
        results.push(`${t.title} — ${tx.hash.slice(0, 10)}`);
        return tx.hash;
      }).catch((e: any) => {
        results.push(`FAIL: ${t.title} — ${e.message?.slice(0, 80)}`);
        return null;
      });
    });

    await Promise.all(txPromises);

    return NextResponse.json({ activeCount, created: results.filter(r => !r.startsWith("FAIL")).length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
