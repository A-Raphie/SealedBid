"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWriteContract, useAccount } from "wagmi";
import AuctionFactoryABI from "~~/contracts/AuctionFactory.abi.json";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { getSepoliaProviderSync } from "~~/lib/sepoliaProvider";

const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "") as `0x${string}`;

const BATCH_SIZE = 4;
const BATCH_DELAY_MS = 300;

export function useAuctionFactory(parameters?: {
  factoryAddress?: string;
  initialMockChains?: Readonly<Record<number, string>>;
}) {
  const factoryAddress = (parameters?.factoryAddress || FACTORY_ADDRESS) as `0x${string}`;
  const hasContract = Boolean(factoryAddress);
  const { address } = useAccount();

  const abi = AuctionFactoryABI as any[];
  const readProvider = useMemo(() => getSepoliaProviderSync(), []);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [auctionCount, setAuctionCount] = useState("0");
  const [auctionAddresses, setAuctionAddresses] = useState<string[]>([]);

  const { writeContractAsync } = useWriteContract();

  const loadFactoryData = useCallback(async () => {
    if (!hasContract) return;
    try {
      const factoryContract = new ethers.Contract(factoryAddress, abi, readProvider);
      const [count, addresses] = await Promise.all([
        factoryContract.getAuctionCount(),
        factoryContract.getAllAuctions(),
      ]);
      setAuctionCount(count.toString());
      setAuctionAddresses(prev => {
        const newAddrs = addresses.map((a: string) => a);
        if (prev.length === newAddrs.length && prev.every((a, i) => a === newAddrs[i])) return prev;
        return newAddrs;
      });
    } catch (e) {
      console.error("Failed to load factory data:", e);
    }
  }, [hasContract, factoryAddress, abi, readProvider]);

  useEffect(() => {
    loadFactoryData();
    const interval = setInterval(loadFactoryData, 20000);
    return () => clearInterval(interval);
  }, [loadFactoryData]);

  const getAuctionInfo = useCallback(
    async (auctionAddr: string) => {
      if (!hasContract) return null;
      try {
        const factoryContract = new ethers.Contract(factoryAddress, abi, readProvider);
        const info = await factoryContract.getAuctionInfo(auctionAddr);
        const auctionContract = new ethers.Contract(auctionAddr, SealedBidAuctionABI, readProvider);
        let itemDescription = "";
        let itemURI = "";
        try {
          itemDescription = await auctionContract.itemDescription();
          itemURI = await auctionContract.itemURI();
        } catch {}
        return {
          auctionAddress: info.auctionAddress,
          creator: info.creator,
          itemTitle: info.itemTitle,
          itemDescription,
          itemURI,
          category: Number(info.category),
          deadline: Number(info.deadline),
          status: Number(info.status),
          bidderCount: Number(info.bidderCount),
        };
      } catch {
        return null;
      }
    },
    [hasContract, factoryAddress, abi, readProvider],
  );

  const createAuction = useCallback(
    async (params: {
      itemURI: string;
      itemTitle: string;
      itemDescription: string;
      paymentToken: string;
      durationSeconds: number;
      category: number;
      nftContract: string;
      nftTokenId: number;
    }) => {
      if (!address || !hasContract) {
        setMessage("Wallet not connected");
        return undefined;
      }
      setIsCreating(true);
      setMessage("Creating auction...");
      try {
        const factoryContract = new ethers.Contract(factoryAddress, abi, readProvider);
        const estimatedGas = await factoryContract.createAuction.estimateGas(
          params.itemURI,
          params.itemTitle,
          params.itemDescription,
          params.paymentToken,
          BigInt(params.durationSeconds),
          BigInt(params.category),
          params.nftContract,
          BigInt(params.nftTokenId),
          { from: address },
        );
        const gasLimit = (estimatedGas * 150n) / 100n;
        const hash = await writeContractAsync({
          address: factoryAddress,
          abi,
          functionName: "createAuction",
          gas: gasLimit,
          args: [
            params.itemURI,
            params.itemTitle,
            params.itemDescription,
            params.paymentToken,
            BigInt(params.durationSeconds),
            BigInt(params.category),
            params.nftContract,
            BigInt(params.nftTokenId),
          ],
        });
        setMessage("Waiting for confirmation...");
        const receipt = await readProvider.waitForTransaction(hash);
        setMessage("Auction created!");
        await loadFactoryData();
        return receipt;
      } catch (e) {
        setMessage(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      } finally {
        setIsCreating(false);
      }
    },
    [address, hasContract, factoryAddress, abi, writeContractAsync, readProvider, loadFactoryData],
  );

  return {
    auctionCount,
    auctionAddresses,
    createAuction,
    getAuctionInfo,
    isCreating,
    message,
    isConnected: !!address,
    hasContract,
    factoryAddress,
    refetchAuctions: loadFactoryData,
    BATCH_SIZE,
    BATCH_DELAY_MS,
  };
}
