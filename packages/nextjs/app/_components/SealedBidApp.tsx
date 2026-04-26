"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFhevm } from "@fhevm-sdk";
import confetti from "canvas-confetti";
import { useAccount, useSwitchChain } from "wagmi";
import { useAuctionFactory } from "~~/hooks/sealedbid/useAuctionFactory";
import { useSealedBidAuction } from "~~/hooks/sealedbid/useSealedBidAuction";
import { type AuctionMetadata, CATEGORY_DEFAULTS, buildItemURI, parseItemURI } from "~~/lib/auction-metadata";

const CATEGORIES = ["All", "NFT Art", "Procurement", "Real Estate", "Freelance", "Commodity"];
const STATUS_BADGE: Record<number, { label: string; cls: string }> = {
  0: { label: "Live", cls: "bg-black/85 text-emerald-300" },
  1: { label: "Revealing", cls: "bg-black/85 text-amber-300" },
  2: { label: "Settled", cls: "bg-black/85 text-sky-300" },
  3: { label: "Canceled", cls: "bg-black/85 text-gray-400" },
  4: { label: "Expired", cls: "bg-black/85 text-red-300" },
  5: { label: "Waiting", cls: "bg-black/85 text-amber-300" },
};

function derivedStatus(status: number, deadline: number, now: number) {
  if (status === 0 && deadline === 0) return 5;
  if (status === 0 && deadline > 0 && deadline <= now) return 4;
  return status;
}

type AuctionInfo = {
  auctionAddress: string;
  creator: string;
  itemTitle: string;
  itemDescription: string;
  itemURI: string;
  category: number;
  deadline: number;
  status: number;
  bidderCount: number;
  bidders?: string[];
};

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Ended";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const MIN_BID = 0.00001;

const bidBelowMin = (val: string) => val !== "" && parseFloat(val) < MIN_BID;

function formatEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth === 0) return "0 ETH";
  if (eth >= 0.000001) return `${parseFloat(eth.toFixed(8))} ETH`;
  return `${wei.toString()} wei`;
}

function playWinSound() {
  try {
    const ctx = new AudioContext();
    const notes = [523, 659, 784];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain).connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.12 + 0.25);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.25);
    });
  } catch {}
}

export const SealedBidApp = () => {
  const { chain, address: accountAddress } = useAccount();
  const { switchChain } = useSwitchChain();
  const chainId = chain?.id;

  useEffect(() => {
    if (accountAddress && chainId && chainId !== 11155111) {
      switchChain?.({ chainId: 11155111 });
    }
  }, [accountAddress, chainId, switchChain]);
  const provider = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return (window as any).ethereum || "https://ethereum-sepolia-rpc.publicnode.com";
  }, []);
  const initialMockChains = { 31337: "http://localhost:8545" };

  const { instance: fhevmInstance } = useFhevm({ provider, chainId, initialMockChains, enabled: true });
  const factory = useAuctionFactory();
  const fheReady = !!fhevmInstance;

  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "mybids">("all");
  const [catFilter, setCatFilter] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [auctionDetails, setAuctionDetails] = useState<Record<string, AuctionInfo>>({});
  const [userBids, setUserBids] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("sealedbid_userbids");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [myBidsPage, setMyBidsPage] = useState(20);
  const [myBidsSort, setMyBidsSort] = useState<"status" | "time" | "result">("status");
  const [showCreate, setShowCreate] = useState(false);
  const prevDeadlinesRef = useRef<Record<string, number>>({});
  const seenWinsRef = useRef<Set<string>>(new Set());
  const replenishFired = useRef(false);

  useEffect(() => {
    if (replenishFired.current) return;
    replenishFired.current = true;
    fetch("/api/replenish").then(r => r.json()).then(data => {
      if (data.created > 0) {
        setTimeout(() => factory.refetchAuctions(), 3000);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const auctionParam = params.get("auction");
    if (auctionParam && auctionParam.startsWith("0x") && auctionParam.length === 42) {
      setSelectedAuction(auctionParam);
    }
  }, []);

  const auction = useSealedBidAuction({
    auctionAddress: selectedAuction ?? undefined,
    instance: fhevmInstance,
  });

  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (factory.auctionAddresses.length === 0) {
      setDetailsLoading(false);
      return;
    }
    const isFirstLoad = Object.keys(auctionDetails).length === 0;
    if (isFirstLoad) setDetailsLoading(true);
    const load = async () => {
      const addresses = factory.auctionAddresses;
      const toFetch = isFirstLoad ? addresses : addresses.filter(a => !auctionDetails[a]);
      if (toFetch.length === 0) {
        setDetailsLoading(false);
        return;
      }
      const BATCH_SIZE = 4;
      const details: Record<string, AuctionInfo> = {};
      for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
        const batch = toFetch.slice(i, i + BATCH_SIZE);
        const entries = await Promise.all(
          batch.map(async addr => {
            const info = await factory.getAuctionInfo(addr);
            return info ? ([addr, info] as const) : null;
          }),
        );
        for (const entry of entries) {
          if (entry) details[entry[0]] = entry[1];
        }
        setAuctionDetails(prev => ({ ...prev, ...details }));
        if (i + BATCH_SIZE < toFetch.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
      setDetailsLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factory.auctionAddresses]);

  useEffect(() => {
    const existing = Object.keys(auctionDetails);
    if (existing.length === 0) return;
    const refresh = async () => {
      const BATCH = 4;
      const updates: Record<string, AuctionInfo> = {};
      for (let i = 0; i < existing.length; i += BATCH) {
        const batch = existing.slice(i, i + BATCH);
        const entries = await Promise.all(
          batch.map(async addr => {
            const info = await factory.getAuctionInfo(addr);
            return info ? ([addr, info] as const) : null;
          }),
        );
        for (const entry of entries) {
          if (entry) updates[entry[0]] = entry[1];
        }
        if (i + BATCH < existing.length) await new Promise(r => setTimeout(r, 300));
      }
      setAuctionDetails(prev => ({ ...prev, ...updates }));
    };
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [Object.keys(auctionDetails).length]);

  const getMeta = (uri?: string): AuctionMetadata | null => {
    if (uri && uri !== "") {
      const parsed = parseItemURI(uri);
      if (parsed) return parsed;
    }
    return null;
  };

  const auctionsList = factory.auctionAddresses
    .map((addr, idx) => {
      const d = auctionDetails[addr];
      if (!d) return null;
      return { ...d, addr, idx, meta: getMeta(d.itemURI) };
    })
    .filter(Boolean) as (AuctionInfo & { addr: string; idx: number; meta: AuctionMetadata | null })[];

  const isShortDuration = (a: { deadline: number; status: number }) =>
    a.status !== 0 || a.deadline === 0 || a.deadline - now <= 15 * 60;
  const activeAuctions = auctionsList.filter(
    a => a.status === 0 && (a.deadline === 0 || (a.deadline > now && a.deadline - now <= 15 * 60)),
  );

  const searchFiltered = searchQuery
    ? activeAuctions.filter(a => a.itemTitle.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeAuctions;

  const filtered = catFilter === 0 ? searchFiltered : searchFiltered.filter(a => a.category + 1 === catFilter);
  const pastAuctions = auctionsList
    .filter(a => a.status !== 0 || a.deadline <= now)
    .filter(isShortDuration)
    .slice(0, 8);

  const totalBids = activeAuctions.reduce((sum, d) => sum + d.bidderCount, 0);

  const lastFinalizeRef = useRef(0);
  useEffect(() => {
    if (!detailsLoading) {
      const t = Date.now();
      if (t - lastFinalizeRef.current > 45000) {
        lastFinalizeRef.current = t;
        fetch("/api/auto-finalize")
          .then(r => r.json())
          .then(console.log)
          .catch(() => {});
      }
    }
  }, [detailsLoading]);

  const myBidAuctions = useMemo(() => {
    if (!accountAddress) return [];
    return auctionsList.filter(a => userBids.has(a.addr));
  }, [auctionsList, userBids, accountAddress]);

  const sortedMyBids = useMemo(() => {
    const sorted = [...myBidAuctions];
    if (myBidsSort === "status") {
      sorted.sort((a, b) => derivedStatus(a.status, a.deadline, now) - derivedStatus(b.status, b.deadline, now));
    } else if (myBidsSort === "time") {
      sorted.sort((a, b) => b.deadline - a.deadline);
    } else {
      sorted.sort((a, b) => (b.status === 2 ? 1 : 0) - (a.status === 2 ? 1 : 0));
    }
    return sorted.slice(0, 100);
  }, [myBidAuctions, myBidsSort, now]);

  useEffect(() => {
    if (Object.keys(auctionDetails).length === 0) return;
    const prev = prevDeadlinesRef.current;
    for (const [addr, detail] of Object.entries(auctionDetails)) {
      if (prev[addr] === 0 && detail.deadline > 0 && detail.deadline < 1e12) {
        setToast({ msg: `${detail.itemTitle || "An auction"} — 10s countdown started!`, type: "success" });
      }
    }
    prevDeadlinesRef.current = Object.fromEntries(
      Object.entries(auctionDetails).map(([addr, d]) => [addr, Number(d.deadline)]),
    );
  }, [auctionDetails]);

  useEffect(() => {
    if (activeTab !== "mybids" || !accountAddress) return;
    const wonAddrs = myBidAuctions.filter(a => a.status === 2).map(a => a.addr);
    const newWins = wonAddrs.filter(a => !seenWinsRef.current.has(a));
    if (newWins.length > 0) {
      playWinSound();
      newWins.forEach(a => seenWinsRef.current.add(a));
    }
  }, [activeTab, myBidAuctions, accountAddress]);

  if (selectedAuction) {
    const detailMeta = auctionDetails[selectedAuction ?? ""]
      ? getMeta(auctionDetails[selectedAuction ?? ""]?.itemURI)
      : null;
    return (
      <AuctionDetail
        auction={auction}
        onBack={() => {
          setSelectedAuction(null);
          window.history.replaceState({}, "", "/");
        }}
        now={now}
        meta={detailMeta}
        fheReady={fheReady}
        onBidPlaced={(addr: string) => {
          setUserBids(prev => {
            const next = new Set(prev).add(addr);
            try { localStorage.setItem("sealedbid_userbids", JSON.stringify([...next])); } catch {}
            return next;
          });
        }}
        onToast={setToast}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e27]">
      <div className="border-b border-white/[0.06] bg-[#0d1129]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4 py-3 sm:py-4">
            <div className="flex-1 relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search auctions..."
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-white text-sm placeholder-gray-500 focus:ring-1 focus:ring-[#FFD208] focus:border-[#FFD208]/30 focus:outline-none"
              />
            </div>
            <span
              className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                fheReady ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400 animate-pulse"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${fheReady ? "bg-green-400" : "bg-amber-400"}`} />
              {fheReady ? "FHE Ready" : "FHE Loading"}
            </span>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#FFD208] text-[#0a0e27] rounded-lg font-semibold text-sm hover:bg-[#e6bd00] transition-all cursor-pointer whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.06] bg-[#0d1129] sticky top-[52px] sm:top-[56px] z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4 py-2">
            <div className="flex gap-1 bg-white/[0.04] rounded-lg p-1">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer ${activeTab === "all" ? "bg-[#FFD208] text-[#0a0e27]" : "text-gray-400 hover:text-white"}`}
              >
                All Auctions ({activeAuctions.length})
              </button>
              <button
                onClick={() => setActiveTab("mybids")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer ${activeTab === "mybids" ? "bg-[#FFD208] text-[#0a0e27]" : "text-gray-400 hover:text-white"}`}
              >
                My Bids{accountAddress ? ` (${myBidAuctions.length})` : ""}
              </button>
            </div>
            {activeTab === "all" && (
              <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                {CATEGORIES.map((cat, i) => (
                  <button
                    key={i}
                    onClick={() => setCatFilter(i)}
                    className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all cursor-pointer rounded-md ${
                      catFilter === i ? "text-white bg-white/[0.08]" : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {activeTab === "mybids" && accountAddress && myBidAuctions.length > 0 && (
              <select
                value={myBidsSort}
                onChange={e => setMyBidsSort(e.target.value as any)}
                className="ml-auto bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white appearance-none cursor-pointer"
              >
                <option value="status">Status (Active first)</option>
                <option value="time">Time (Newest)</option>
                <option value="result">Result (Won first)</option>
              </select>
            )}
            {activeTab === "all" && (
              <span className="ml-auto hidden sm:flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
                <span>{totalBids} Encrypted Bids</span>
                <span className="text-white/10">|</span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  FHE Protected
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-6 sm:pt-4 sm:pb-8 space-y-8">
        {activeTab === "all" && (
          <>
            {detailsLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="bg-[#1a1f3a] rounded-xl overflow-hidden">
                    <div className="aspect-[4/3] skeleton-shimmer" />
                    <div className="p-4 space-y-2.5">
                      <div className="h-4 skeleton-shimmer rounded w-3/4" />
                      <div className="h-3 skeleton-shimmer rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!detailsLoading && (
              <section>
                <h2 className="text-base font-semibold text-white mb-4 tracking-tight">
                  {searchQuery ? `Results for "${searchQuery}"` : "All Auctions"}
                </h2>
                {filtered.length === 0 ? (
                  <div className="text-center py-16 text-gray-500">
                    <p className="text-sm">No auctions found</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filtered.map(a => (
                      <AuctionCard
                        key={a.addr}
                        info={a}
                        now={now}
                        onClick={() => setSelectedAuction(a.addr)}
                        hasUserBid={userBids.has(a.addr)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
            {!detailsLoading && pastAuctions.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-white mb-4 tracking-tight text-gray-400">Past Auctions</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pastAuctions.map(a => (
                    <AuctionCard key={a.addr} info={a} now={now} onClick={() => setSelectedAuction(a.addr)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "mybids" && (
          <div>
            {!accountAddress ? (
              <div className="text-center py-20 text-gray-500">
                <p className="text-lg mb-2">Connect wallet to see your bids</p>
                <p className="text-sm">Use the connect button in the top right</p>
              </div>
            ) : myBidAuctions.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                <p className="text-lg mb-2">No bids yet</p>
                <p className="text-sm">Browse auctions and place your first encrypted bid</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-gray-400 text-sm">
                    {myBidAuctions.length} auction{myBidAuctions.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {sortedMyBids.slice(0, myBidsPage).map(a => (
                    <AuctionCardMyBid
                      key={a.addr}
                      info={a}
                      now={now}
                      onClick={() => setSelectedAuction(a.addr)}
                      isNew={a.status === 2 && !seenWinsRef.current.has(a.addr)}
                    />
                  ))}
                </div>
                {myBidsPage < sortedMyBids.length && (
                  <div className="text-center mt-6">
                    <button
                      onClick={() => setMyBidsPage(p => p + 20)}
                      className="px-6 py-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-sm text-gray-300 cursor-pointer transition-all"
                    >
                      Load More ({sortedMyBids.length - myBidsPage} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-white/[0.04] mt-12 py-6 text-center">
        <p className="text-xs text-gray-600">
          Built by{" "}
          <a
            href="https://x.com/A_raphie"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-[#FFD208] transition-colors"
          >
            Raphie
          </a>
        </p>
      </footer>

      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all animate-[slideIn_0.3s_ease-out] ${toast.type === "success" ? "bg-green-600/90 text-white" : "bg-red-600/90 text-white"}`}
        >
          {toast.msg}
        </div>
      )}

      {showCreate && <CreateAuctionModal factory={factory} onClose={() => setShowCreate(false)} />}
    </div>
  );
};

function AuctionCardMyBid({
  info,
  now,
  onClick,
  isNew,
}: {
  info: AuctionInfo & { addr: string; idx: number; meta: AuctionMetadata | null };
  now: number;
  onClick: () => void;
  isNew?: boolean;
}) {
  const meta = parseItemURI(info.itemURI);
  const catDefault = CATEGORY_DEFAULTS[info.category ?? 0] ?? CATEGORY_DEFAULTS[0];
  const image = meta?.image ?? catDefault.image;
  const ds = derivedStatus(info.status, info.deadline, now);
  const badge = STATUS_BADGE[ds] ?? STATUS_BADGE[3];
  const isWaiting = info.deadline === 0;
  const isWon = info.status === 2;
  const timeLeft = isWaiting ? -1 : Math.max(0, info.deadline - now);

  return (
    <div
      onClick={onClick}
      className={`bg-[#1a1f3a] rounded-xl overflow-hidden cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-[#FFD208]/5 border flex flex-col ${isWon ? "border-[#FFD208]/40" : "border-white/[0.06]"}`}
    >
      <div className="aspect-[4/3] relative overflow-hidden">
        <img src={image} alt={info.itemTitle} className="w-full h-full object-cover" />
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-1 ring-black/20 ${badge.cls}`}>
            {badge.label}
          </span>
          {isWon && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFD208]/20 text-[#FFD208] backdrop-blur-sm">
              Won!
            </span>
          )}
          {isNew && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/20 text-green-400 backdrop-blur-sm animate-pulse">
              NEW
            </span>
          )}
        </div>
      </div>
      <div className="p-3.5 flex flex-col flex-1">
        <h3 className="text-sm font-medium text-white truncate">{info.itemTitle}</h3>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-gray-400">
            {info.bidderCount} bid{info.bidderCount !== 1 ? "s" : ""}
          </span>
          {isWaiting ? (
            <span className="text-[11px] text-amber-400">Waiting for bids</span>
          ) : (
            <span
              className={`text-[11px] font-mono ${timeLeft === 0 ? "text-gray-600" : timeLeft < 600 ? "text-amber-400" : "text-gray-500"}`}
            >
              {formatCountdown(timeLeft)}
            </span>
          )}
        </div>
        <div className="mt-auto pt-1.5 text-[10px] text-gray-500 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          Your bid: encrypted
        </div>
      </div>
    </div>
  );
}

function AuctionCard({
  info,
  now,
  onClick,
  hasUserBid,
}: {
  info: AuctionInfo & { addr: string; idx: number; meta: AuctionMetadata | null };
  now: number;
  onClick: () => void;
  hasUserBid?: boolean;
}) {
  const timeLeft = info.deadline === 0 ? -1 : Math.max(0, info.deadline - now);
  const badge = STATUS_BADGE[derivedStatus(info.status, info.deadline, now)] ?? STATUS_BADGE[3];
  const catDefault = CATEGORY_DEFAULTS[info.category ?? 0] ?? CATEGORY_DEFAULTS[0];
  const image = info.meta?.image ?? catDefault.image;
  const isWaiting = info.deadline === 0;

  return (
    <div
      onClick={onClick}
      className={`bg-[#1a1f3a] rounded-xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-white/10 transition-all group flex flex-col ${isWaiting ? "border border-[#FFD208]/20 animate-pulse" : ""}`}
    >
      <div className="aspect-[4/3] relative overflow-hidden">
        <img
          src={image}
          alt=""
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          loading="lazy"
        />
        <span className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-1 ring-black/20 ${badge.cls}`}>
          {badge.label}
        </span>
        {hasUserBid && (
          <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-1 ring-black/20 bg-black/85 text-yellow-300">
            Your Bid
          </span>
        )}
      </div>
      <div className="p-3.5 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[11px] text-gray-500">{CATEGORIES[info.category + 1]}</span>
        </div>
        <h3 className="text-sm font-semibold text-white truncate">{info.itemTitle}</h3>
        {info.meta?.estimatedValue && (
          <div className="text-sm text-[#FFD208] mt-1 font-medium">{info.meta.estimatedValue}</div>
        )}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
          <span className="text-xs text-gray-400">
            {info.bidderCount} bid{info.bidderCount !== 1 ? "s" : ""}
          </span>
          {info.status === 0 &&
            (isWaiting ? (
              <span className="text-[11px] text-amber-400">Be the first to bid</span>
            ) : (
              <span
                className={`text-[11px] font-mono ${timeLeft === 0 ? "text-gray-600" : timeLeft < 600 ? "text-amber-400" : "text-gray-500"}`}
              >
                {formatCountdown(timeLeft)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

function AuctionDetail({
  auction,
  onBack,
  now,
  meta,
  fheReady,
  onBidPlaced,
  onToast,
}: {
  auction: ReturnType<typeof useSealedBidAuction>;
  onBack: () => void;
  now: number;
  meta: AuctionMetadata | null;
  fheReady: boolean;
  onBidPlaced: (addr: string) => void;
  onToast: (t: { msg: string; type: "success" | "error" } | null) => void;
}) {
  const { address: accountAddress } = useAccount();
  const [bidAmount, setBidAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"description" | "bidders" | "fhe">("description");
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingStart, setCheckingStart] = useState(0);
  const [settleStep, setSettleStep] = useState("");
  const [settleError, setSettleError] = useState(false);
  const autoSettleFired = useRef(false);
  const { auctionAddress, auctionData, placeBid, cancelAuction, isProcessing, processingStep, message } = auction;

  useEffect(() => {
    setBidAmount("");
    setChecking(false);
    setCheckingStart(0);
    setActiveTab("description");
    setSettleStep("");
    setSettleError(false);
    autoSettleFired.current = false;
  }, [auctionAddress]);

  const isCreator = accountAddress?.toLowerCase() === auctionData.creator?.toLowerCase();
  const hasBid = auctionData.bidders.some(b => b.toLowerCase() === accountAddress?.toLowerCase());
  const isWaiting = (auctionData.deadline ?? 0) === 0;
  const timeLeft = isWaiting ? -1 : Math.max(0, (auctionData.deadline ?? 0) - now);
  const isActive = auctionData.status === 0 && (isWaiting || timeLeft > 0);
  const isExpired = auctionData.status === 0 && !isWaiting && timeLeft === 0;
  const isEnded = auctionData.status === 1;
  const badge = STATUS_BADGE[derivedStatus(auctionData.status ?? 0, auctionData.deadline ?? 0, now)] ?? STATUS_BADGE[3];
  const catDefault = CATEGORY_DEFAULTS[auctionData.category ?? 0] ?? CATEGORY_DEFAULTS[0];
  const image = meta?.image ?? catDefault.image;
  const needsSettle = isEnded || (isExpired && auctionData.bidderCount > 0);

  useEffect(() => {
    if (!auctionAddress || !needsSettle || autoSettleFired.current) return;
    autoSettleFired.current = true;
    fetch(`/api/trigger-settle?addr=${auctionAddress}`).catch(() => {});
  }, [auctionAddress, needsSettle]);

  const handleBid = async (amount: string) => {
    if (!amount || bidBelowMin(amount)) return;
    await placeBid(amount);
    if (auctionAddress) onBidPlaced(auctionAddress);
  };

  useEffect(() => {
    if (message && !isProcessing) {
      if (message.includes("success") || message.includes("placed")) {
        onToast({ msg: message, type: "success" });
      } else if (message.includes("fail") || message.includes("error") || message.includes("reject")) {
        onToast({ msg: message, type: "error" });
      }
    }
  }, [message, isProcessing]);

  const showBidBar = isActive && fheReady;

  const shownResultRef = useRef(false);
  useEffect(() => {
    shownResultRef.current = false;
  }, [auctionAddress]);
  useEffect(() => {
    if (auctionData.status === 2 && auctionData.winner && !shownResultRef.current) {
      shownResultRef.current = true;
      const isWinner = auctionData.winner.toLowerCase() === accountAddress?.toLowerCase();
      if (isWinner) {
        playWinSound();
        confetti({ particleCount: 200, spread: 90, origin: { y: 0.6 } });
        setTimeout(() => confetti({ particleCount: 150, spread: 120, origin: { y: 0.4 } }), 400);
      } else if (hasBid) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
      }
    }
  }, [auctionData.status, auctionData.winner, accountAddress]);

  return (
    <div className="min-h-screen bg-[#0a0e27]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white cursor-pointer text-sm transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <button
            onClick={() => {
              const addr = auctionAddress;
              if (addr && addr.startsWith("0x") && addr.length === 42) {
                navigator.clipboard.writeText(`${window.location.origin}?auction=${addr}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="text-gray-500 hover:text-white cursor-pointer text-sm transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            {copied ? "Copied!" : "Share"}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
          <div className="lg:col-span-2">
            <div className="aspect-square rounded-xl overflow-hidden bg-[#1a1f3a]">
              <img src={image} alt="" className="w-full h-full object-cover" />
            </div>
          </div>

          <div className="lg:col-span-3 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>
                <span className="text-xs text-gray-500">{CATEGORIES[(auctionData.category ?? 0) + 1]}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                {auctionData.itemTitle ?? "Loading..."}
              </h1>
              {meta?.location && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                  </svg>
                  {meta.location}
                </p>
              )}
            </div>

            <div className="bg-[#1a1f3a] rounded-xl p-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="min-h-[3.5rem]">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wider">Value</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{meta?.estimatedValue ?? "N/A"}</div>
                </div>
                <div className="min-h-[3.5rem]">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wider">Bids</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{auctionData.bidderCount}</div>
                </div>
                <div className="min-h-[3.5rem]">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wider">Time Left</div>
                  <div
                    className={`text-sm font-semibold mt-0.5 ${isWaiting ? "text-amber-400" : timeLeft === 0 ? "text-gray-600" : timeLeft < 600 ? "text-amber-400" : "text-white"}`}
                  >
                    {isWaiting ? "Waiting" : isActive ? formatCountdown(timeLeft) : badge.label}
                  </div>
                  {isWaiting && <div className="text-[10px] text-gray-500 mt-0.5">Timer starts on first bid</div>}
                </div>
              </div>
            </div>

            {isActive && !hasBid && (
              <div className="bg-[#1a1f3a] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Place Encrypted Bid</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-green-500/10 text-green-400 font-medium">
                    FHE Protected
                  </span>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="0.00001"
                      min="0.00001"
                      value={bidAmount}
                      onChange={e => setBidAmount(e.target.value)}
                      disabled={isProcessing}
                      placeholder="0.00"
                      className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2.5 pr-14 text-white text-sm focus:ring-1 focus:ring-[#FFD208] focus:outline-none placeholder-gray-600 disabled:opacity-40 ${bidBelowMin(bidAmount) ? "border-red-500/50" : "border-white/[0.08]"}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium">
                      ETH
                    </span>
                  </div>
                  <button
                    onClick={() => handleBid(bidAmount)}
                    disabled={!bidAmount || bidBelowMin(bidAmount) || isProcessing || !fheReady}
                    className="bg-[#FFD208] text-[#0a0e27] px-5 py-2.5 font-semibold rounded-lg hover:bg-[#e6bd00] disabled:opacity-50 cursor-pointer text-sm transition-all flex items-center gap-2 whitespace-nowrap"
                  >
                    {isProcessing ? (
                      <span className="inline-block w-4 h-4 border-2 border-[#0a0e27]/30 border-t-[#0a0e27] rounded-full animate-spin" />
                    ) : isWaiting ? (
                      "Place Opening Bid"
                    ) : (
                      "Place Bid"
                    )}
                  </button>
                </div>
                {bidBelowMin(bidAmount) && <p className="text-[10px] text-red-400">Minimum bid is {MIN_BID} ETH</p>}
                {isProcessing && (
                  <div className="space-y-1.5">
                    <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                          processingStep === "encrypting"
                            ? "w-1/3 bg-[#FFD208]"
                            : processingStep === "submitting"
                              ? "w-2/3 bg-[#FFD208]"
                              : processingStep === "confirming"
                                ? "w-full bg-[#FFD208]"
                                : "w-full bg-green-400"
                        }`}
                      />
                    </div>
                    <p className="text-[11px] text-[#FFD208]">
                      {processingStep === "encrypting" && "Step 1/3 — Encrypting..."}
                      {processingStep === "submitting" && "Step 2/3 — Submitting..."}
                      {processingStep === "confirming" && "Step 3/3 — Confirming..."}
                    </p>
                  </div>
                )}
                {message && !isProcessing && (
                  <p
                    className={`text-xs ${message.includes("success") || message.includes("placed") ? "text-green-400" : message.includes("cancelled") ? "text-gray-400" : "text-red-400"}`}
                  >
                    {message}
                  </p>
                )}
              </div>
            )}

            {isActive && hasBid && (
              <div className="bg-[#1a1f3a] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-sm font-semibold text-green-400">Bid Placed</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-green-500/10 text-green-400 font-medium">
                    FHE Protected
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  Your bid is encrypted on-chain. Update anytime before the auction ends.
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="0.00001"
                      min="0.00001"
                      value={bidAmount}
                      onChange={e => setBidAmount(e.target.value)}
                      disabled={isProcessing}
                      placeholder="New amount"
                      className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2.5 pr-14 text-white text-sm focus:ring-1 focus:ring-[#FFD208] focus:outline-none placeholder-gray-600 disabled:opacity-40 ${bidBelowMin(bidAmount) ? "border-red-500/50" : "border-white/[0.08]"}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium">
                      ETH
                    </span>
                  </div>
                  <button
                    onClick={() => handleBid(bidAmount)}
                    disabled={!bidAmount || bidBelowMin(bidAmount) || isProcessing || !fheReady}
                    className="bg-[#FFD208] text-[#0a0e27] px-5 py-2.5 font-semibold rounded-lg hover:bg-[#e6bd00] disabled:opacity-50 cursor-pointer text-sm transition-all flex items-center gap-2 whitespace-nowrap"
                  >
                    {isProcessing ? (
                      <span className="inline-block w-4 h-4 border-2 border-[#0a0e27]/30 border-t-[#0a0e27] rounded-full animate-spin" />
                    ) : (
                      "Update"
                    )}
                  </button>
                </div>
                {bidBelowMin(bidAmount) && <p className="text-[10px] text-red-400">Minimum bid is {MIN_BID} ETH</p>}
                {isProcessing && (
                  <div className="space-y-1.5">
                    <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                          processingStep === "encrypting"
                            ? "w-1/3 bg-[#FFD208]"
                            : processingStep === "submitting"
                              ? "w-2/3 bg-[#FFD208]"
                              : processingStep === "confirming"
                                ? "w-full bg-[#FFD208]"
                                : "w-full bg-green-400"
                        }`}
                      />
                    </div>
                    <p className="text-[11px] text-[#FFD208]">
                      {processingStep === "encrypting" && "Step 1/3 — Encrypting..."}
                      {processingStep === "submitting" && "Step 2/3 — Submitting..."}
                      {processingStep === "confirming" && "Step 3/3 — Confirming..."}
                    </p>
                  </div>
                )}
                {message && !isProcessing && (
                  <p
                    className={`text-xs ${message.includes("success") || message.includes("placed") ? "text-green-400" : message.includes("cancelled") ? "text-gray-400" : "text-red-400"}`}
                  >
                    {message}
                  </p>
                )}
              </div>
            )}

            {needsSettle && !checking && !settleError && (
              <div className="bg-[#1a1f3a] rounded-xl p-4 text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-[#FFD208]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-sm font-semibold text-white">Auction Ended</p>
                </div>
                <p className="text-xs text-gray-500">Winner can now be determined via FHE</p>
                <button
                  onClick={async () => {
                    if (!auctionAddress || checking) return;
                    setChecking(true);
                    setSettleError(false);
                    setCheckingStart(Date.now());
                    try {
                      const poll = async (attempts = 0) => {
                        if (attempts > 80) {
                          setSettleError(true);
                          return;
                        }
                        const s = await auction.checkStatus();
                        if (s === 2) {
                          await auction.refetchAll();
                          return;
                        }
                        const res = await fetch(`/api/trigger-settle?addr=${auctionAddress}`).catch(() => null);
                        if (res) {
                          const data = await res.json().catch(() => ({} as any));
                          if (data.error) {
                            setSettleError(true);
                            return;
                          }
                          if (data.step) setSettleStep(data.step);
                        }
                        await new Promise(res => setTimeout(res, 1500));
                        await poll(attempts + 1);
                      };
                      await poll();
                    } finally {
                      setChecking(false);
                    }
                  }}
                  className="bg-[#FFD208] text-[#0a0e27] px-5 py-2 font-semibold rounded-lg hover:bg-[#e6bd00] cursor-pointer text-sm transition-all"
                >
                  Check Winner
                </button>
              </div>
            )}

            {needsSettle && !checking && settleError && (
              <div className="bg-[#1a1f3a] rounded-xl p-4 text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <p className="text-sm font-semibold text-white">FHE Relayer Unavailable</p>
                </div>
                <p className="text-xs text-gray-500">Could not determine winner. The FHE decryption service may be temporarily down.</p>
                <button
                  onClick={async () => {
                    if (!auctionAddress || checking) return;
                    setSettleError(false);
                    setChecking(true);
                    setCheckingStart(Date.now());
                    try {
                      const poll = async (attempts = 0) => {
                        if (attempts > 80) {
                          setSettleError(true);
                          return;
                        }
                        const s = await auction.checkStatus();
                        if (s === 2) {
                          await auction.refetchAll();
                          return;
                        }
                        const res = await fetch(`/api/trigger-settle?addr=${auctionAddress}`).catch(() => null);
                        if (res) {
                          const data = await res.json().catch(() => ({} as any));
                          if (data.error) {
                            setSettleError(true);
                            return;
                          }
                          if (data.step) setSettleStep(data.step);
                        }
                        await new Promise(res => setTimeout(res, 1500));
                        await poll(attempts + 1);
                      };
                      await poll();
                    } finally {
                      setChecking(false);
                    }
                  }}
                  className="bg-amber-500 text-[#0a0e27] px-5 py-2 font-semibold rounded-lg hover:bg-amber-400 cursor-pointer text-sm transition-all"
                >
                  Retry
                </button>
              </div>
            )}

            {needsSettle && checking && (
              <div className="bg-[#1a1f3a] rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-[#FFD208] animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm font-semibold text-white">
                    {settleStep || "Determining winner\u2026"}
                  </p>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {checkingStart > 0
                    ? `~${Math.max(0, 120 - Math.floor((Date.now() - checkingStart) / 1000))}s remaining`
                    : "FHE decryption in progress"}
                </p>
              </div>
            )}

            {auctionData.winner &&
              auctionData.winner !== ZERO_ADDR &&
              auctionData.status === 2 &&
              (() => {
                const isWinner = auctionData.winner.toLowerCase() === accountAddress?.toLowerCase();
                const isLoser = hasBid && !isWinner;
                return (
                  <div className="bg-[#1a1f3a] rounded-xl p-4 space-y-3">
                    {isWinner && (
                      <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                          />
                        </svg>
                        You Won!
                      </h3>
                    )}
                    {isLoser && (
                      <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                          />
                        </svg>
                        You Lost
                      </h3>
                    )}
                    {!hasBid && !isCreator && (
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                          />
                        </svg>
                        Auction Settled
                      </h3>
                    )}
                    {isCreator && !hasBid && (
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                          />
                        </svg>
                        Auction Settled
                      </h3>
                    )}
                    <div
                      className={`${isWinner ? "bg-green-500/[0.06] border-green-500/10" : isLoser ? "bg-red-500/[0.06] border-red-500/10" : "bg-[#FFD208]/10 border-[#FFD208]/10"} border rounded-lg p-4 text-center space-y-1`}
                    >
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                        {isWinner ? "Winning Bid" : "Winner"}
                      </div>
                      {!isWinner && (
                        <div className="text-sm font-mono text-white">
                          {auctionData.winner.slice(0, 6)}...{auctionData.winner.slice(-4)}
                        </div>
                      )}
                      {auctionData.winningBid !== undefined && auctionData.winningBid > 0n && (
                        <div className="text-lg font-bold text-[#FFD208]">{formatEth(auctionData.winningBid)}</div>
            )}
          </div>
                   </div>
                );
              })()}

            {isExpired && !isEnded && auctionData.bidderCount === 0 && (
              <div className="bg-[#1a1f3a] rounded-xl p-4 text-center">
                <p className="text-sm font-semibold text-white">No Bids Received</p>
                <p className="text-xs text-gray-500 mt-1">This auction expired with no bids.</p>
              </div>
            )}

            <div className="border-b border-white/[0.06] flex gap-0 -mb-px">
              {(["description", "bidders", "fhe"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium capitalize cursor-pointer border-b-2 transition-all ${
                    activeTab === tab
                      ? "text-white border-[#FFD208]"
                      : "text-gray-500 border-transparent hover:text-gray-300"
                  }`}
                >
                  {tab === "fhe" ? "How FHE Works" : tab}
                </button>
              ))}
            </div>

            <div className="bg-[#1a1f3a] rounded-xl p-4">
              {activeTab === "description" && (
                <div className="space-y-3">
                  {auctionData.itemDescription ? (
                    <p className="text-sm text-gray-300 leading-relaxed">{auctionData.itemDescription}</p>
                  ) : (
                    <p className="text-sm text-gray-500">No description available.</p>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/[0.04]">
                    {meta?.condition && (
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Condition</div>
                        <div className="text-sm text-white mt-0.5">{meta.condition}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Creator</div>
                      <div className="text-sm text-white mt-0.5 font-mono">
                        {auctionData.creator?.slice(0, 6)}...{auctionData.creator?.slice(-4)}
                      </div>
                    </div>
                    {meta?.reservePrice && (
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Reserve</div>
                        <div className={`text-sm mt-0.5 ${meta.reserveMet ? "text-green-400" : "text-red-400"}`}>
                          {meta.reservePrice}
                        </div>
                      </div>
                    )}
                  </div>
                  {meta?.tags && meta.tags.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap pt-2">
                      {meta.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-md text-[11px] bg-white/[0.04] text-gray-400">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "bidders" && (
                <div>
                  {!isEnded && auctionData.status !== 2 && auctionData.bidders.length > 0 && (
                    <p className="text-xs text-gray-500 mb-3">Bidder identities are hidden until the auction ends.</p>
                  )}
                  {auctionData.bidders.length === 0 ? (
                    <p className="text-sm text-gray-500">No bids yet.</p>
                  ) : isEnded || auctionData.status === 2 ? (
                    <div className="space-y-1.5">
                      {auctionData.bidders.map((bidder, i) => (
                        <div key={i} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded-lg">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#FFD208] to-amber-600 flex items-center justify-center text-[9px] text-black font-bold">
                              {i + 1}
                            </div>
                            <span className="font-mono text-xs text-gray-300">
                              {bidder.slice(0, 6)}...{bidder.slice(-4)}
                              {bidder.toLowerCase() === accountAddress?.toLowerCase() && (
                                <span className="text-[#FFD208] ml-1.5 text-[10px] font-semibold">(You)</span>
                              )}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-500">Encrypted</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex -space-x-1.5">
                        {auctionData.bidders.slice(0, 5).map((_, i) => (
                          <div
                            key={i}
                            className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FFD208]/80 to-amber-600/80 flex items-center justify-center text-[10px] text-black font-bold border-2 border-[#1a1f3a]"
                          >
                            ?
                          </div>
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">
                        {auctionData.bidders.length} encrypted bid{auctionData.bidders.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "fhe" && (
                <div className="space-y-3">
                  {[
                    "Your bid is encrypted client-side using Fully Homomorphic Encryption",
                    "The encrypted bid is submitted on-chain — nobody can read it",
                    "When the auction ends, FHE finds the winner via homomorphic comparison",
                    "Only the winning bid amount is decrypted — all others stay private",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-md bg-[#FFD208]/10 text-[#FFD208] flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <p className="text-sm text-gray-400 leading-relaxed">{step}</p>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-white/[0.04]">
                    <span className="text-[10px] px-2.5 py-1 rounded-md bg-[#FFD208]/[0.06] text-[#FFD208]/70 font-semibold">
                      Powered by Zama FHE
                    </span>
                  </div>
                </div>
              )}
            </div>

            {isCreator && auctionData.status === 0 && !isProcessing && (
              <button
                onClick={() => cancelAuction()}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-gray-400 text-sm hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Cancel Auction
              </button>
            )}
          </div>
        </div>
      </div>

      {showBidBar && !isProcessing && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0d1129] border-t border-white/[0.06] p-3 safe-area-bottom">
          <div className="flex gap-2 max-w-lg mx-auto">
            <div className="relative flex-1">
              <input
                type="number"
                step="0.00001"
                min="0.00001"
                value={bidAmount}
                onChange={e => setBidAmount(e.target.value)}
                placeholder="0.00"
                className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2.5 pr-14 text-white text-sm focus:ring-1 focus:ring-[#FFD208] focus:outline-none placeholder-gray-600 ${bidBelowMin(bidAmount) ? "border-red-500/50" : "border-white/[0.08]"}`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium">ETH</span>
            </div>
            <button
              onClick={() => handleBid(bidAmount)}
              disabled={!bidAmount || bidBelowMin(bidAmount) || !fheReady}
              className="bg-[#FFD208] text-[#0a0e27] px-6 py-2.5 font-semibold rounded-lg disabled:opacity-50 cursor-pointer text-sm"
            >
              {hasBid ? "Update" : "Bid"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateAuctionModal({
  factory,
  onClose,
}: {
  factory: ReturnType<typeof useAuctionFactory>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(1);
  const [durationInput, setDurationInput] = useState("10");
  const [durationUnit, setDurationUnit] = useState<"seconds" | "minutes" | "hours" | "days">("seconds");
  const UNIT_MULTIPLIERS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 } as const;
  const UNIT_MAX = { seconds: 59, minutes: 59, hours: 23, days: 30 } as const;
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [estimatedValue, setEstimatedValue] = useState("");
  const [condition, setCondition] = useState<string>("New");
  const [location, setLocation] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const IMGBB_KEY = process.env.NEXT_PUBLIC_IMGBB_KEY || "";

  const compressAndUpload = (file: File) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const MAX = 1200;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) {
            h = Math.round((h * MAX) / w);
            w = MAX;
          } else {
            w = Math.round((w * MAX) / h);
            h = MAX;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          async blob => {
            if (!blob) { setUploading(false); return; }
            setImagePreview(URL.createObjectURL(blob));
            try {
              const formData = new FormData();
              formData.append("image", blob, "auction.jpg");
              const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
                method: "POST",
                body: formData,
              });
              const json = await res.json();
              if (json.success) {
                setImageUrl(json.data.display_url);
              }
            } catch {
              setImageUrl("");
            } finally {
              setUploading(false);
            }
          },
          "image/jpeg",
          0.8,
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    compressAndUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleSubmit = async () => {
    if (!title) return;
    const metadata = buildItemURI({
      image: imageUrl || undefined,
      estimatedValue: estimatedValue || undefined,
      condition: condition as any,
      location: location || undefined,
      tags: [],
      reserveMet: false,
    } as Partial<AuctionMetadata>);
    const result = await factory.createAuction({
      itemURI: metadata,
      itemTitle: title,
      itemDescription: description,
      paymentToken: ZERO_ADDR,
      durationSeconds: (Number(durationInput) || 1) * UNIT_MULTIPLIERS[durationUnit],
      category: category - 1,
      nftContract: ZERO_ADDR,
      nftTokenId: 0,
    });
    if (result) onClose();
  };

  const inputCls =
    "w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm focus:ring-1 focus:ring-[#FFD208] focus:outline-none placeholder-gray-600";

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1f3a] border border-white/[0.06] rounded-xl p-5 sm:p-6 max-w-md w-full space-y-4 max-h-[85vh] overflow-y-auto safe-area-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Create Auction</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className={inputCls}
            placeholder="e.g. Digital Sunset Painting"
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Describe the item"
          />
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <div>
            <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Category</label>
            <select
              value={category}
              onChange={e => setCategory(Number(e.target.value))}
              className={`${inputCls} appearance-none`}
            >
              {CATEGORIES.slice(1).map((cat, i) => (
                <option key={i} value={i + 1} className="bg-[#1a1f3a]">
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Duration</label>
            <div className="flex gap-2">
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    const v = Number(durationInput);
                    setDurationInput(String(Math.max(1, v - 1)));
                  }}
                  className="px-3 py-2.5 text-[#FFD208] hover:bg-white/[0.08] transition-colors text-lg font-bold select-none"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={durationInput}
                  onChange={e => setDurationInput(e.target.value)}
                  onBlur={() => {
                    const v = Number(durationInput);
                    setDurationInput(v >= 1 ? String(Math.min(v, UNIT_MAX[durationUnit])) : "1");
                  }}
                  className="w-12 bg-transparent text-center text-white text-sm focus:outline-none border-x border-white/[0.08] py-2.5"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = Number(durationInput);
                    setDurationInput(String(Math.min(UNIT_MAX[durationUnit], v + 1)));
                  }}
                  className="px-3 py-2.5 text-[#FFD208] hover:bg-white/[0.08] transition-colors text-lg font-bold select-none"
                >
                  +
                </button>
              </div>
              <select
                value={durationUnit}
                onChange={e => {
                  const unit = e.target.value as keyof typeof UNIT_MAX;
                  setDurationUnit(unit);
                  const v = Number(durationInput);
                  if (v > UNIT_MAX[unit]) setDurationInput(String(UNIT_MAX[unit]));
                }}
                className={`${inputCls} appearance-none flex-1`}
              >
                <option value="seconds" className="bg-[#1a1f3a]">Seconds</option>
                <option value="minutes" className="bg-[#1a1f3a]">Minutes</option>
                <option value="hours" className="bg-[#1a1f3a]">Hours</option>
                <option value="days" className="bg-[#1a1f3a]">Days</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Image</label>
          {uploading ? (
            <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-[#FFD208]/40 rounded-lg bg-[#FFD208]/5">
              <div className="w-6 h-6 border-2 border-[#FFD208] border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-[#FFD208] text-xs">Uploading image...</span>
            </div>
          ) : imagePreview ? (
            <div className="relative group">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-full h-40 object-cover rounded-lg border border-white/[0.08]"
              />
              <button
                onClick={() => {
                  setImageUrl("");
                  setImagePreview("");
                }}
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                isDragging
                  ? "border-[#FFD208] bg-[#FFD208]/5"
                  : "border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.02]"
              }`}
            >
              <svg className="w-8 h-8 text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span className="text-gray-500 text-xs">Drag & drop or click to upload</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="mt-2">
            <input
              type="text"
              value={imagePreview ? "" : imageUrl}
              onChange={e => {
                setImageUrl(e.target.value);
                setImagePreview("");
              }}
              className={inputCls}
              placeholder="Or paste image URL..."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Est. Value</label>
            <input
              type="text"
              value={estimatedValue}
              onChange={e => setEstimatedValue(e.target.value)}
              className={inputCls}
              placeholder="e.g. ~0.1 ETH"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Condition</label>
            <select
              value={condition}
              onChange={e => setCondition(e.target.value)}
              className={`${inputCls} appearance-none`}
            >
              <option className="bg-[#1a1f3a]">New</option>
              <option className="bg-[#1a1f3a]">Used</option>
              <option className="bg-[#1a1f3a]">Digital</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 mb-1 uppercase tracking-wider">Location</label>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            className={inputCls}
            placeholder="e.g. Remote"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!title || factory.isCreating}
          className="w-full bg-[#FFD208] text-[#0a0e27] py-2.5 font-semibold rounded-lg hover:bg-[#e6bd00] disabled:opacity-50 cursor-pointer text-sm transition-all"
        >
          {factory.isCreating ? "Creating..." : "Create Auction"}
        </button>

        {factory.message && (
          <div className="text-xs text-gray-400 bg-white/[0.02] rounded-lg p-3">{factory.message}</div>
        )}
      </div>
    </div>
  );
}
