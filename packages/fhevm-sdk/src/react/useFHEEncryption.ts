"use client";

import { useCallback, useMemo } from "react";
import { FhevmInstance } from "../fhevmTypes.js";
import { RelayerEncryptedInput } from "@zama-fhe/relayer-sdk/web";
import { ethers } from "ethers";

export type EncryptResult = {
  handles: Uint8Array[];
  inputProof: Uint8Array;
};

export const getEncryptionMethod = (internalType: string) => {
  switch (internalType) {
    case "externalEbool":
      return "addBool" as const;
    case "externalEuint8":
      return "add8" as const;
    case "externalEuint16":
      return "add16" as const;
    case "externalEuint32":
      return "add32" as const;
    case "externalEuint64":
      return "add64" as const;
    case "externalEuint128":
      return "add128" as const;
    case "externalEuint256":
      return "add256" as const;
    case "externalEaddress":
      return "addAddress" as const;
    default:
      console.warn(`Unknown internalType: ${internalType}, defaulting to add64`);
      return "add64" as const;
  }
};

export const toHex = (value: Uint8Array | string): `0x${string}` => {
  if (typeof value === "string") {
    return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
  }
  return ("0x" + Buffer.from(value).toString("hex")) as `0x${string}`;
};

export const buildParamsFromAbi = (enc: EncryptResult, abi: any[], functionName: string): any[] => {
  const fn = abi.find((item: any) => item.type === "function" && item.name === functionName);
  if (!fn) throw new Error(`Function ABI not found for ${functionName}`);

  return fn.inputs.map((input: any, index: number) => {
    const raw = index === 0 ? enc.handles[0] : enc.inputProof;
    switch (input.type) {
      case "bytes32":
      case "bytes":
        return toHex(raw);
      case "uint256":
        return BigInt(raw as unknown as string);
      case "address":
      case "string":
        return raw as unknown as string;
      case "bool":
        return Boolean(raw);
      default:
        console.warn(`Unknown ABI param type ${input.type}; passing as hex`);
        return toHex(raw);
    }
  });
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return bytes;
}

const MAX_RETRIES = 3;
const RETRY_DELAY = 3000;
const ENCRYPTION_TIMEOUT = 30000;

export type EncryptStatus = {
  attempt: number;
  maxRetries: number;
  serverFallback: boolean;
};

export const useFHEEncryption = (params: {
  instance: FhevmInstance | undefined;
  ethersSigner: ethers.JsonRpcSigner | undefined;
  contractAddress: `0x${string}` | undefined;
}) => {
  const { instance, ethersSigner, contractAddress } = params;

  const canEncrypt = useMemo(
    () => Boolean(contractAddress),
    [contractAddress],
  );

  const encryptWith = useCallback(
    async (
      weiValue: bigint,
      onStatusChange?: (status: EncryptStatus) => void,
    ): Promise<EncryptResult | undefined> => {
      if (!contractAddress) return undefined;
      const userAddress = ethersSigner ? await ethersSigner.getAddress() : undefined;
      if (!userAddress) return undefined;

      if (instance) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          onStatusChange?.({ attempt, maxRetries: MAX_RETRIES, serverFallback: false });
          try {
            const input = instance.createEncryptedInput(contractAddress, userAddress) as RelayerEncryptedInput;
            (input as any).add64(weiValue);
            const enc = await Promise.race([
              input.encrypt(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Encryption timed out")), ENCRYPTION_TIMEOUT),
              ),
            ]);
            return enc;
          } catch {
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, RETRY_DELAY));
            }
          }
        }
      }

      onStatusChange?.({ attempt: 0, maxRetries: 0, serverFallback: true });
      try {
        const res = await fetch("/api/encrypt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: weiValue.toString(), contractAddress, userAddress }),
        });
        if (!res.ok) return undefined;
        const data = await res.json();
        if (!data.handles?.[0] || !data.inputProof) return undefined;
        return {
          handles: [hexToBytes(data.handles[0])],
          inputProof: hexToBytes(data.inputProof),
        };
      } catch {
        return undefined;
      }
    },
    [instance, ethersSigner, contractAddress],
  );

  return { canEncrypt, encryptWith } as const;
};
