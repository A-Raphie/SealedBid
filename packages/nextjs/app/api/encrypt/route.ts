import { NextRequest, NextResponse } from "next/server";
import { getFHEInstance } from "~~/lib/decrypt-and-settle";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { value, contractAddress, userAddress } = await req.json();
    if (!value || !contractAddress || !userAddress) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const instance = await getFHEInstance();
    const input = instance.createEncryptedInput(contractAddress, userAddress);
    input.add64(BigInt(value));

    const enc = await Promise.race([
      input.encrypt(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Server encryption timed out")), 50000),
      ),
    ]);

    const handles = Array.isArray(enc.handles) ? enc.handles : [enc.handles];
    return NextResponse.json({
      handles: handles.map((h: Uint8Array) => "0x" + Buffer.from(h).toString("hex")),
      inputProof: "0x" + Buffer.from(enc.inputProof).toString("hex"),
    });
  } catch (e: any) {
    console.error("/api/encrypt error:", e.message?.slice(0, 200));
    return NextResponse.json({ error: e.message?.slice(0, 200) || "Encryption failed" }, { status: 500 });
  }
}
