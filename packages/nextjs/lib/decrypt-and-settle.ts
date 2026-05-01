import { ethers } from "ethers";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { RELAYER_RPC } from "~~/lib/rpc-config";
import { setSettleStep } from "~~/lib/settle-cache";

let cachedInstance: any = null;
let instancePromise: Promise<any> | null = null;

export async function getFHEInstance() {
  if (cachedInstance) return cachedInstance;
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    const { createInstance, SepoliaConfig } = await import("@zama-fhe/relayer-sdk/node");
    cachedInstance = await createInstance({
      ...SepoliaConfig,
      relayerUrl: `${SepoliaConfig.relayerUrl}/v2`,
      network: RELAYER_RPC,
      relayerRouteVersion: 2,
    });
    return cachedInstance;
  })();
  return instancePromise;
}

export function prewarmFHE() {
  getFHEInstance().catch(() => {});
}

export async function decryptAndSettle(
  auctionAddr: string,
  wallet: ethers.HDNodeWallet,
  provider: ethers.JsonRpcProvider,
): Promise<{ winnerAddr: string; winningBid: bigint } | null> {
  const auction = new ethers.Contract(auctionAddr, SealedBidAuctionABI as any[], provider);
  const auctionWrite = new ethers.Contract(auctionAddr, SealedBidAuctionABI as any[], wallet);

  setSettleStep(auctionAddr, "Reading auction data...");
  const [winningBidHandle, winningIndexHandle, bidders, winner, resultsComputed] = await Promise.all([
    auction.getWinningBid(),
    auction.getWinningBidderIndex(),
    auction.getBidders(),
    auction.winner(),
    auction.resultsComputed(),
  ]);

  if (!resultsComputed) return null;
  if (winner !== ethers.ZeroAddress) {
    const onChainBid = await auction.winningBid();
    return { winnerAddr: winner, winningBid: BigInt(onChainBid) };
  }
  if (bidders.length === 0) return null;

  setSettleStep(auctionAddr, "Connecting to encryption service...");
  const instance = await getFHEInstance();

  setSettleStep(auctionAddr, "Preparing decryption...");
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365;
  const contractAddresses = [auctionAddr];

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);

  setSettleStep(auctionAddr, "Authorizing decryption...");
  const signature = await wallet.signTypedData(
    eip712.domain,
    {
      UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification],
    },
    eip712.message,
  );

  const handles = [];
  if (winningBidHandle && winningBidHandle !== ethers.ZeroHash) {
    handles.push({ handle: winningBidHandle, contractAddress: auctionAddr });
  }
  if (winningIndexHandle && winningIndexHandle !== ethers.ZeroHash) {
    handles.push({ handle: winningIndexHandle, contractAddress: auctionAddr });
  }

  if (handles.length === 0) return null;

  setSettleStep(auctionAddr, "Decrypting bids...");
  const decrypted = await instance.userDecrypt(
    handles as [{ handle: string; contractAddress: string }, ...{ handle: string; contractAddress: string }[]],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    contractAddresses,
    wallet.address,
    startTimestamp,
    durationDays,
  );

  const indexVal = decrypted[winningIndexHandle];
  if (indexVal === undefined || indexVal === null) return null;

  const winnerIndex = Number(indexVal);
  if (winnerIndex >= bidders.length) return null;

  const winnerAddr = bidders[winnerIndex];

  const bidVal = decrypted[winningBidHandle];
  const winningBid = bidVal !== undefined && bidVal !== null ? BigInt(bidVal) : 0n;

  setSettleStep(auctionAddr, "Recording result...");
  await auctionWrite.settleAuction(winnerAddr, winningBid);

  setSettleStep(auctionAddr, "Confirming on blockchain...");

  return { winnerAddr, winningBid };
}
