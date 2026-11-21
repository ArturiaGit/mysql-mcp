import { hash, verify } from '@node-rs/argon2';

export class Argon2Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly maxConcurrent = 8, readonly maxQueue = 32) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent && this.waiters.length >= this.maxQueue) throw new Error('ARGON2_CAPACITY_EXCEEDED');
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    try { return await operation(); }
    finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

export const argon2Semaphore = new Argon2Semaphore();
const options = { algorithm: 2, memoryCost: 65_536, timeCost: 3, parallelism: 4 };

export function hashPassword(password: string): Promise<string> {
  return argon2Semaphore.run(() => hash(password, options));
}

export function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return argon2Semaphore.run(() => verify(encoded, password));
}
