"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildParamsFromAbi, useFHEEncryption } from "@fhevm-sdk";
import type { FhevmInstance } from "@fhevm-sdk";
import { ethers } from "ethers";
import { useAccount, useWriteContract } from "wagmi";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { getPollProvider, getSepoliaProviderSync } from "~~/lib/rpc-config";

type AuctionData = {
  creator: string | undefined;
  itemTitle: string | undefined;
  itemDescription: string | undefined;
  deadline: number | undefined;
  category: number | undefined;
  status: number | undefined;
  bidderCount: number;
  bidders: string[];
  winner: string | undefined;
  winningBid: bigint | undefined;
  resultsComputed: boolean | undefined;
};

const EMPTY_DATA: AuctionData = {
  creator: undefined,
  itemTitle: undefined,
  itemDescription: undefined,
  deadline: undefined,
  category: undefined,
  status: undefined,
  bidderCount: 0,
  bidders: [],
  winner: undefined,
  winningBid: undefined,
  resultsComputed: false,
};

export function useSealedBidAuction(parameters: {
  auctionAddress: string | undefined;
  instance: FhevmInstance | undefined;
  initialMockChains?: Readonly<Record<number, string>>;
}) {
  const { auctionAddress, instance } = parameters;
  const { address: accountAddress } = useAccount();

  const abi = SealedBidAuctionABI as any[];
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [processingStep, setProcessingStep] = useState<
    "idle" | "encrypting" | "submitting" | "confirming" | "done" | "error"
  >("idle");
  const [auctionData, setAuctionData] = useState<AuctionData>(EMPTY_DATA);

  useEffect(() => {
    setMessage("");
    setIsProcessing(false);
    setProcessingStep("idle");
  }, [auctionAddress]);

  const readProvider = useMemo(() => getSepoliaProviderSync(), []);
  const pollProvider = useMemo(() => getPollProvider(), []);
  const { writeContractAsync } = useWriteContract();

  const encryptionSigner = useMemo(() => {
    if (!accountAddress) return undefined;
    return { getAddress: async () => accountAddress } as unknown as ethers.JsonRpcSigner;
  }, [accountAddress]);

  const addr = auctionAddress as `0x${string}` | undefined;

  const loadAuctionData = useCallback(async (): Promise<AuctionData> => {
    if (!auctionAddress) {
      setAuctionData(EMPTY_DATA);
      return EMPTY_DATA;
    }
    try {
      const contract = new ethers.Contract(auctionAddress, abi, readProvider);

      const results = await Promise.allSettled([
        contract.creator(),
        contract.itemTitle(),
        contract.itemDescription(),
        contract.deadline(),
        contract.category(),
        contract.status(),
        contract.getBidderCount(),
        contract.getBidders(),
        contract.winner(),
        contract.winningBid(),
        contract.resultsComputed(),
      ]);

      const val = (i: number) => (results[i].status === "fulfilled" ? results[i].value : undefined);

      const winner = val(8);
      const winningBid = val(9);

      const data: AuctionData = {
        creator: val(0),
        itemTitle: val(1),
        itemDescription: val(2),
        deadline: val(3) !== undefined ? Number(val(3)) : undefined,
        category: val(4) !== undefined ? Number(val(4)) : undefined,
        status: val(5) !== undefined ? Number(val(5)) : undefined,
        bidderCount: val(6) !== undefined ? Number(val(6)) : 0,
        bidders: val(7) ? (val(7) as string[]).map((b: string) => b) : [],
        winner: winner === ethers.ZeroAddress ? undefined : winner,
        winningBid: winningBid !== undefined && Number(winningBid) > 0 ? BigInt(winningBid) : undefined,
        resultsComputed: val(10) ?? false,
      };
      setAuctionData(data);
      return data;
    } catch (e) {
      console.error("Failed to load auction data:", e);
      return EMPTY_DATA;
    }
  }, [auctionAddress, abi, readProvider]);

  const checkStatus = useCallback(async (): Promise<number | undefined> => {
    if (!auctionAddress) return undefined;
    try {
      const contract = new ethers.Contract(auctionAddress, abi, pollProvider);
      const s = await contract.status();
      return Number(s);
    } catch {
      return undefined;
    }
  }, [auctionAddress, abi, pollProvider]);

  useEffect(() => {
    loadAuctionData();
    const needsFastPoll =
      auctionData.status === 0
        ? (auctionData.deadline ?? 0) > 0 && (auctionData.deadline ?? 0) <= Math.floor(Date.now() / 1000)
        : auctionData.status === 1;
    const interval = setInterval(loadAuctionData, needsFastPoll ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [loadAuctionData, auctionData.status, auctionData.deadline]);

  const { encryptWith } = useFHEEncryption({
    instance,
    ethersSigner: encryptionSigner,
    contractAddress: auctionAddress as `0x${string}` | undefined,
  });

  const placeBid = useCallback(
    async (bidAmount: string) => {
      if (!auctionAddress || isProcessing) return;
      if (!instance) {
        setMessage("FHE not initialized — please wait or refresh the page");
        return;
      }
      if (!accountAddress) {
        setMessage("Please connect your wallet first");
        return;
      }
      const weiValue = BigInt(Math.round(parseFloat(bidAmount) * 1e18));
      if (!weiValue || weiValue <= 0n) return;
      setIsProcessing(true);
      setProcessingStep("encrypting");
      setMessage("Encrypting your bid...");
      await new Promise(r => setTimeout(r, 50));
      try {
        const enc = await encryptWith(weiValue, status => {
          if (status.serverFallback) {
            setMessage("Trying server-side encryption...");
          } else if (status.attempt > 1) {
            setMessage(`Retrying encryption (${status.attempt}/${status.maxRetries})...`);
          }
        });
        if (!enc) {
          setMessage("Encryption failed — Zama FHE relayer is unavailable. Please try again.");
          setProcessingStep("error");
          setIsProcessing(false);
          return;
        }

        setProcessingStep("submitting");
        setMessage("Submitting encrypted bid...");
        const params = buildParamsFromAbi(enc, [...abi], "placeBid");

        const hash = await writeContractAsync({
          address: addr!,
          abi,
          functionName: "placeBid",
          args: params,
        });

        setProcessingStep("confirming");
        setMessage("Waiting for confirmation...");
        await readProvider.waitForTransaction(hash);
        setProcessingStep("done");
        setMessage("Bid placed successfully!");
        await loadAuctionData();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setProcessingStep("error");
        setMessage(
          /user rejected/i.test(msg)
            ? "Bid cancelled — you rejected the transaction in your wallet."
            : `Bid failed: ${msg.slice(0, 120)}`,
        );
      } finally {
        setIsProcessing(false);
        setTimeout(() => setProcessingStep("idle"), 3000);
      }
    },
    [
      instance,
      auctionAddress,
      isProcessing,
      encryptWith,
      writeContractAsync,
      addr,
      abi,
      readProvider,
      loadAuctionData,
      accountAddress,
    ],
  );

  const cancelAuction = useCallback(
    async () => {
      if (!auctionAddress) return;
      setIsProcessing(true);
      setProcessingStep("submitting");
      setMessage("Canceling auction...");
      try {
        const hash = await writeContractAsync({
          address: auctionAddress as `0x${string}`,
          abi,
          functionName: "cancelAuction",
          args: [],
        });
        setProcessingStep("confirming");
        setMessage("Waiting for confirmation...");
        await readProvider.waitForTransaction(hash);
        setProcessingStep("done");
        setMessage("Auction canceled");
        await loadAuctionData();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setProcessingStep("error");
        setMessage(
          /user rejected/i.test(msg)
            ? "Cancelled — you rejected the transaction."
            : `Cancel failed: ${msg.slice(0, 120)}`,
        );
      } finally {
        setIsProcessing(false);
        setTimeout(() => setProcessingStep("idle"), 3000);
      }
    },
    [auctionAddress, abi, writeContractAsync, readProvider, loadAuctionData],
  );

  return {
    auctionAddress,
    auctionData,
    placeBid,
    cancelAuction,
    isProcessing,
    processingStep,
    message,
    refetchAll: loadAuctionData,
    checkStatus,
  };
}
