import { ApiError } from './errors.js';

const windowMs = 300_000;
const lockMs = 900_000;
const maxEntries = 10_000;

export class IpAttemptLimiter {
  private readonly entries = new Map<string, { timestamps: number[]; lockedUntil: number; expiresAt: number }>();

  constructor(private readonly limit: number) {}

  admit(ip: string, now = Date.now()): void {
    let state = this.entries.get(ip);
    if (!state || state.expiresAt <= now) {
      if (this.entries.size >= maxEntries) {
        for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
        if (this.entries.size >= maxEntries) throw new ApiError(429, 'ERR_RATE_LIMIT_USER', { retry_after_sec: 60 });
      }
      state = { timestamps: [], lockedUntil: 0, expiresAt: now + windowMs };
      this.entries.set(ip, state);
    }
    if (state.lockedUntil > now) throw new ApiError(429, 'ERR_RATE_LIMIT_USER', { retry_after_sec: Math.ceil((state.lockedUntil - now) / 1000) });
    state.timestamps = state.timestamps.filter((timestamp) => timestamp > now - windowMs);
    if (state.timestamps.length >= this.limit) {
      state.lockedUntil = state.expiresAt = now + lockMs;
      throw new ApiError(429, 'ERR_RATE_LIMIT_USER', { retry_after_sec: lockMs / 1000 });
    }
    state.timestamps.push(now);
    state.expiresAt = now + windowMs;
  }
}
