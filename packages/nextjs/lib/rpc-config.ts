import { ethers } from "ethers";

const SEPOLIA_RPCS = [
  "https://sepolia.infura.io/v3/b7a8e92c88ea49bb9604db817c7f6cb7",
  "https://eth-sepolia.g.alchemy.com/v2/_02KIc2YqRqViId1-mLOq",
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://1rpc.io/sepolia",
  "https://rpc.sepolia.org",
  "https://sepolia.drpc.org",
];

export const INFURA_RPC = SEPOLIA_RPCS[0];
export const RELAYER_RPC = SEPOLIA_RPCS[1];
export const POLL_RPC = "https://1rpc.io/sepolia";
export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "";
export const DEPLOYER_MNEMONIC = process.env.DEPLOYER_MNEMONIC || "";
export const AUCTION_DURATION = 10;

const SEPOLIA_NETWORK = { chainId: 11155111, name: "sepolia" };

async function tryProvider(rpcs: string[]): Promise<ethers.JsonRpcProvider> {
  for (const url of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url, SEPOLIA_NETWORK, {
        batchMaxCount: 1,
        staticNetwork: true,
      });
      await p.getBlockNumber();
      return p;
    } catch {
      continue;
    }
  }
  return new ethers.JsonRpcProvider(rpcs[0], SEPOLIA_NETWORK, {
    batchMaxCount: 1,
    staticNetwork: true,
  });
}

function syncProvider(url: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(url, SEPOLIA_NETWORK, {
    batchMaxCount: 1,
    staticNetwork: true,
  });
}

let _provider: ethers.JsonRpcProvider | null = null;
let _providerPromise: Promise<ethers.JsonRpcProvider> | null = null;

export async function getSepoliaProvider(): Promise<ethers.JsonRpcProvider> {
  if (_provider) return _provider;
  if (_providerPromise) return _providerPromise;
  _providerPromise = tryProvider(SEPOLIA_RPCS).then(p => {
    _provider = p;
    return p;
  });
  return _providerPromise;
}

export function getSepoliaProviderSync(): ethers.JsonRpcProvider {
  if (_provider) return _provider;
  return syncProvider(SEPOLIA_RPCS[1]);
}

let _settleProvider: ethers.JsonRpcProvider | null = null;
let _settlePromise: Promise<ethers.JsonRpcProvider> | null = null;

export async function getSettleProvider(): Promise<ethers.JsonRpcProvider> {
  if (_settleProvider) return _settleProvider;
  if (_settlePromise) return _settlePromise;
  _settlePromise = tryProvider(SEPOLIA_RPCS.slice(0, 2)).then(p => {
    _settleProvider = p;
    return p;
  });
  return _settlePromise;
}

export function getDeployerWallet(provider: ethers.JsonRpcProvider): ethers.HDNodeWallet {
  return ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(DEPLOYER_MNEMONIC)).connect(provider);
}

let _pollProvider: ethers.JsonRpcProvider | null = null;

export function getPollProvider(): ethers.JsonRpcProvider {
  if (_pollProvider) return _pollProvider;
  _pollProvider = new ethers.JsonRpcProvider(POLL_RPC, SEPOLIA_NETWORK, {
    batchMaxCount: 1,
    staticNetwork: true,
  });
  return _pollProvider;
}
