import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ServerError } from './errors.js';

export const SESSION_COOKIE = 'mysql_mcp_session';
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const LOCAL_CODE_TTL_MS = 5 * 60 * 1000;
const token = (): string => randomBytes(32).toString('base64url');
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
const equal = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));
interface Session { csrf: string; expires: number }

export class LocalAuth {
  private codeHash: Buffer | null = null;
  private codeExpires = 0;
  private readonly sessions = new Map<string, Session>();
  private attempts = 0;
  private windowStart = 0;

  constructor(private readonly now: () => number = Date.now) {}

  // Only called by a trusted local launcher, never from a public HTTP route.
  issueLocalCode(): string {
    const code = token();
    this.codeHash = digest(code);
    this.codeExpires = this.now() + LOCAL_CODE_TTL_MS;
    return code;
  }

  exchange(code: unknown): { id: string; csrf: string } {
    const now = this.now();
    if (now - this.windowStart >= 60_000) { this.attempts = 0; this.windowStart = now; }
    if (++this.attempts > 10) throw new ServerError('RESOURCE_LIMIT');
    if (typeof code !== 'string' || code.length > 128 || !this.codeHash ||
        now >= this.codeExpires || !timingSafeEqual(digest(code), this.codeHash)) {
      throw new ServerError('UNAUTHENTICATED');
    }
    this.prune();
    if (this.sessions.size >= 16) throw new ServerError('RESOURCE_LIMIT');
    this.codeHash = null;
    const id = token();
    const csrf = token();
    this.sessions.set(id, { csrf, expires: now + SESSION_TTL_MS });
    return { id, csrf };
  }

  authenticate(cookie: string | undefined, csrf?: string, mutate = false): string {
    this.prune();
    const parts = (cookie ?? '').split(';').map(value => value.trim())
      .filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    const id = parts.length === 1 ? parts[0]?.slice(SESSION_COOKIE.length + 1) : undefined;
    const session = id && /^[A-Za-z0-9_-]{43}$/.test(id) ? this.sessions.get(id) : undefined;
    if (!id || !session) throw new ServerError('UNAUTHENTICATED');
    if (mutate && (typeof csrf !== 'string' || csrf.length > 128 || !equal(csrf, session.csrf))) {
      throw new ServerError('FORBIDDEN');
    }
    return id;
  }

  logout(id: string): void { this.sessions.delete(id); }
  clear(): void { this.sessions.clear(); this.codeHash = null; }
  private prune(): void {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(id);
  }
}

export function sessionCookie(id: string, clear = false): string {
  return `${SESSION_COOKIE}=${clear ? '' : id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_TTL_MS / 1000}`;
}
