import { Injectable } from "@nestjs/common";

type Bucket = { tokens: number; updatedAt: number; lastSeenAt: number };

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

@Injectable()
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  consume(
    key: string,
    capacity: number,
    refillPerMinute: number,
    now = Date.now(),
  ): RateLimitDecision {
    const safeCapacity = Math.max(1, Math.floor(capacity));
    const refillPerMs = Math.max(1, refillPerMinute) / 60_000;
    const current = this.buckets.get(key) ?? {
      tokens: safeCapacity,
      updatedAt: now,
      lastSeenAt: now,
    };
    current.tokens = Math.min(
      safeCapacity,
      current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs,
    );
    current.updatedAt = now;
    current.lastSeenAt = now;
    const allowed = current.tokens >= 1;
    if (allowed) current.tokens -= 1;
    this.buckets.set(key, current);
    if (++this.operations % 1_000 === 0) this.prune(now);
    return {
      allowed,
      remaining: Math.max(0, Math.floor(current.tokens)),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((1 - current.tokens) / refillPerMs / 1_000)),
    };
  }

  private prune(now: number) {
    const staleBefore = now - 10 * 60_000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < staleBefore) this.buckets.delete(key);
    }
    if (this.buckets.size <= 50_000) return;
    const overflow = this.buckets.size - 50_000;
    const oldest = [...this.buckets.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, overflow);
    for (const [key] of oldest) this.buckets.delete(key);
  }
}
