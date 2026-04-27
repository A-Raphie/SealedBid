const MAX_ATTEMPTS = 5;
const ERROR_RETRY_MS = 30_000;
const PENDING_TIMEOUT_MS = 180_000;

type SettleState = {
  status: "pending" | "done";
  step?: string;
  winner?: string;
  winningBid?: string;
  error?: string;
  attempts: number;
  updatedAt: number;
};

const cache = new Map<string, SettleState>();

export function getSettleState(addr: string): SettleState | undefined {
  const entry = cache.get(addr.toLowerCase());
  if (!entry) return undefined;
  if (entry.status === "pending" && Date.now() - entry.updatedAt > PENDING_TIMEOUT_MS) {
    cache.delete(addr.toLowerCase());
    return undefined;
  }
  if (entry.error && Date.now() - entry.updatedAt > ERROR_RETRY_MS) {
    cache.delete(addr.toLowerCase());
    return undefined;
  }
  return entry;
}

export function canRetry(addr: string): boolean {
  const entry = cache.get(addr.toLowerCase());
  if (!entry) return true;
  return entry.attempts < MAX_ATTEMPTS;
}

export function incrementAttempt(addr: string): number {
  const key = addr.toLowerCase();
  const entry = cache.get(key);
  const attempts = (entry?.attempts ?? 0) + 1;
  cache.set(key, { status: "pending", step: "Starting...", attempts, updatedAt: Date.now() });
  return attempts;
}

export function setSettlePending(addr: string, step: string) {
  const key = addr.toLowerCase();
  const entry = cache.get(key);
  const attempts = entry?.attempts ?? 0;
  cache.set(key, { status: "pending", step, attempts, updatedAt: Date.now() });
}

export function setSettleStep(addr: string, step: string) {
  const entry = cache.get(addr.toLowerCase());
  if (entry && entry.status === "pending") {
    entry.step = step;
    entry.updatedAt = Date.now();
  }
}

export function setSettleDone(addr: string, winner: string, winningBid: string) {
  const key = addr.toLowerCase();
  const entry = cache.get(key);
  cache.set(key, { status: "done", winner, winningBid, attempts: entry?.attempts ?? 0, updatedAt: Date.now() });
}

export function setSettleError(addr: string, error: string) {
  const key = addr.toLowerCase();
  const entry = cache.get(key);
  cache.set(key, {
    status: "done",
    error,
    attempts: entry?.attempts ?? 0,
    updatedAt: Date.now(),
  });
}

export function clearSettleEntry(addr: string) {
  cache.delete(addr.toLowerCase());
}
