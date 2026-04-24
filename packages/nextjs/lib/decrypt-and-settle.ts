import { ethers } from "ethers";
import SealedBidAuctionABI from "~~/contracts/SealedBidAuction.abi.json";
import { RELAYER_RPC } from "~~/lib/rpc-config";
import { setSettleStep } from "~~/lib/settle-cache";

const MAX_RETRIES = 3;

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

async function attemptDecryptAndSettle(
  auctionAddr: string,
  wallet: ethers.HDNodeWallet,
  provider: ethers.JsonRpcProvider,
): Promise<{ winnerAddr: string; winningBid: bigint } | null> {
  const auction = new ethers.Contract(auctionAddr, SealedBidAuctionABI as any[], provider);
  const auctionWrite = new ethers.Contract(auctionAddr, SealedBidAuctionABI as any[], wallet);

  setSettleStep(auctionAddr, "Reading auction state...");
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

  setSettleStep(auctionAddr, "Connecting to FHE relayer...");
  const instance = await getFHEInstance();

  setSettleStep(auctionAddr, "Generating decryption keypair...");
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365;
  const contractAddresses = [auctionAddr];

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);

  setSettleStep(auctionAddr, "Signing decryption request...");
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

  setSettleStep(auctionAddr, "Decrypting via FHE homomorphic comparison...");
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

  setSettleStep(auctionAddr, "Submitting result on-chain...");
  const settleTx = await auctionWrite.settleAuction(winnerAddr, winningBid);

  setSettleStep(auctionAddr, "Confirming transaction...");
  await settleTx.wait();

  return { winnerAddr, winningBid };
}

export async function decryptAndSettle(
  auctionAddr: string,
  wallet: ethers.HDNodeWallet,
  provider: ethers.JsonRpcProvider,
): Promise<{ winnerAddr: string; winningBid: bigint } | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await attemptDecryptAndSettle(auctionAddr, wallet, provider);
    } catch (e: any) {
      console.error(`decryptAndSettle attempt ${attempt}/${MAX_RETRIES} for ${auctionAddr}:`, e.message?.slice(0, 120));
      if (attempt < MAX_RETRIES) {
        setSettleStep(auctionAddr, `Retrying (${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  return null;
}
