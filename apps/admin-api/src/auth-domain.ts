import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PasswordPolicyDTO } from '@mysql-mcp/shared-types';

export const SESSION_COOKIE = 'mcp_admin_sid';
export const CSRF_COOKIE = 'mcp_csrf_seed';
export const SESSION_TTL_SECONDS = 28_800;
export const PASSWORD_MIN_DAYS = 30;
export const PASSWORD_MAX_DAYS = 180;
export const PASSWORD_DAY_MS = 86_400_000;

export function newSecret(bytes = 32): string { return randomBytes(bytes).toString('hex'); }

export function csrfToken(seed: string, secret: string): string {
  return createHmac('sha256', secret).update(seed).digest('hex');
}

export function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hasStrongPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 64
    && /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

interface DaysRemainingConfig { millisecondsPerDay: number; disabledValue: number; }

export const PROVISIONAL_RD_08_DAYS_REMAINING: Readonly<DaysRemainingConfig> = Object.freeze({
  millisecondsPerDay: PASSWORD_DAY_MS,
  disabledValue: -1,
});

// PROVISIONAL (RD-08 #5): Arturia confirmation is still required.
export function calculateDaysRemaining(
  expiresAt: Date | null,
  now: Date,
  config: Readonly<DaysRemainingConfig> = PROVISIONAL_RD_08_DAYS_REMAINING,
): number {
  if (expiresAt === null) return config.disabledValue;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / config.millisecondsPerDay));
}

export function passwordExpiry(updatedAt: Date, days: number | null): Date | null {
  return days === null ? null : new Date(updatedAt.getTime() + days * PASSWORD_DAY_MS);
}

export function passwordPolicyDTO(days: number | null, updatedAt: Date, now = new Date()): PasswordPolicyDTO {
  const expiresAt = passwordExpiry(updatedAt, days);
  return {
    passwordExpiresDays: days,
    passwordExpiresAt: expiresAt?.toISOString() ?? null,
    isExpirationEnabled: days !== null,
    daysRemaining: calculateDaysRemaining(expiresAt, now),
    isExpired: expiresAt !== null && now.getTime() > expiresAt.getTime(),
    minDays: PASSWORD_MIN_DAYS,
    maxDays: PASSWORD_MAX_DAYS,
  };
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key && value) result.set(key, value);
  }
  return result;
}

export function cookie(name: string, value: string, secure: boolean, maxAge: number): string {
  return `${name}=${value}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
