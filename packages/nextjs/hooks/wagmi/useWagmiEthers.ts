"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { useAccount, useWalletClient } from "wagmi";

export const useWagmiEthers = (initialMockChains?: Readonly<Record<number, string>>) => {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();

  const chainId = chain?.id ?? walletClient?.chain?.id;
  const accounts = address ? [address] : undefined;

  const ethersProvider = useMemo(() => {
    if (!walletClient) return undefined;

    const eip1193Provider = {
      request: async (args: any) => {
        return await walletClient.request(args);
      },
      on: () => {},
      removeListener: () => {},
    } as ethers.Eip1193Provider;

    return new ethers.BrowserProvider(eip1193Provider);
  }, [walletClient]);

  const ethersReadonlyProvider = useMemo(() => {
    if (!ethersProvider) return undefined;
    const rpcUrl = initialMockChains?.[chainId || 0];
    if (rpcUrl) {
      return new ethers.JsonRpcProvider(rpcUrl);
    }
    return ethersProvider;
  }, [ethersProvider, initialMockChains, chainId]);

  const [ethersSigner, setEthersSigner] = useState<ethers.JsonRpcSigner | ethers.ContractRunner | null>(null);

  useEffect(() => {
    if (!ethersProvider || !address) {
      setEthersSigner(null);
      return;
    }
    ethersProvider.getSigner().then(setEthersSigner).catch(() => setEthersSigner(null));
  }, [ethersProvider, address]);

  const ropRef = useRef<typeof ethersReadonlyProvider>(ethersReadonlyProvider);
  const chainIdRef = useRef<number | undefined>(chainId);

  useEffect(() => {
    ropRef.current = ethersReadonlyProvider;
  }, [ethersReadonlyProvider]);

  useEffect(() => {
    chainIdRef.current = chainId;
  }, [chainId]);

  return {
    chainId,
    accounts,
    isConnected,
    ethersProvider,
    ethersReadonlyProvider,
    ethersSigner,
    ropRef,
    chainIdRef,
  } as const;
};
