type SettleState = {
  status: "pending" | "done";
  step?: string;
  winner?: string;
  winningBid?: string;
  error?: string;
  updatedAt: number;
};

const cache = new Map<string, SettleState>();

export function getSettleState(addr: string): SettleState | undefined {
  const entry = cache.get(addr.toLowerCase());
  if (!entry) return undefined;
  if (entry.status === "pending" && Date.now() - entry.updatedAt > 180_000) {
    cache.delete(addr.toLowerCase());
    return undefined;
  }
  return entry;
}

export function setSettlePending(addr: string, step: string) {
  cache.set(addr.toLowerCase(), { status: "pending", step, updatedAt: Date.now() });
}

export function setSettleStep(addr: string, step: string) {
  const entry = cache.get(addr.toLowerCase());
  if (entry && entry.status === "pending") {
    entry.step = step;
    entry.updatedAt = Date.now();
  }
}

export function setSettleDone(addr: string, winner: string, winningBid: string) {
  cache.set(addr.toLowerCase(), { status: "done", winner, winningBid, updatedAt: Date.now() });
}

export function setSettleError(addr: string, error: string) {
  const entry = cache.get(addr.toLowerCase());
  if (entry) {
    entry.status = "done";
    entry.error = error;
    entry.updatedAt = Date.now();
  }
}

export function clearSettleEntry(addr: string) {
  cache.delete(addr.toLowerCase());
}
