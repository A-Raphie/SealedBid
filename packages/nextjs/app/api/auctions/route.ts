import { after } from "next/server";
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import AuctionFactoryABI from "~~/contracts/AuctionFactory.abi.json";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { FACTORY_ADDRESS, getSettleProvider } from "~~/lib/rpc-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CachedData = {
  addresses: string[];
  details: Record<string, any>;
  timestamp: number;
};

let cache: CachedData | null = null;
const CACHE_TTL = 15_000;
let refreshing = false;

async function refreshCache() {
  if (refreshing) return cache;
  refreshing = true;
  try {
    const provider = await getSettleProvider();
    const factory = new ethers.Contract(FACTORY_ADDRESS, AuctionFactoryABI as any[], provider);
    const addresses: string[] = await factory.getAllAuctions();

    const details: Record<string, any> = {};
    const BATCH = 4;
    for (let i = 0; i < addresses.length; i += BATCH) {
      const batch = addresses.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async addr => {
          const info = await factory.getAuctionInfo(addr);
          let itemDescription = "";
          let itemURI = "";
          try {
            const auction = new ethers.Contract(addr, SealedBidAuctionABI as any[], provider);
            itemDescription = await auction.itemDescription();
            itemURI = await auction.itemURI();
          } catch {}
          return {
            addr,
            data: {
              auctionAddress: addr,
              creator: info.creator,
              itemTitle: info.itemTitle,
              itemDescription,
              itemURI,
              category: Number(info.category),
              deadline: Number(info.deadline),
              status: Number(info.status),
              bidderCount: Number(info.bidderCount),
            },
          };
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          details[r.value.addr] = r.value.data;
        }
      }
      if (i + BATCH < addresses.length) await new Promise(r => setTimeout(r, 200));
    }

    cache = { addresses, details, timestamp: Date.now() };
    return cache;
  } finally {
    refreshing = false;
  }
}

export async function GET() {
  try {
    if (!FACTORY_ADDRESS) {
      return NextResponse.json({ error: "Missing config" }, { status: 500 });
    }

    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      after(refreshCache);
      return NextResponse.json(cache);
    }

    const data = await refreshCache();
    return NextResponse.json(data);
  } catch (e: any) {
    if (cache) {
      return NextResponse.json(cache);
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
