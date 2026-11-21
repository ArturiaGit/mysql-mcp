import { describe, expect, it } from 'vitest';
import {
  CurrentUserResponseSchema,
  PasswordPolicySchema,
  RegisterRequestSchema,
  UpdatePasswordPolicyRequestSchema,
  UserProfileSchema,
} from '../auth.schema';

describe('auth.schema runtime validation', () => {
  it('accepts nullable email and 64-bit decimal EntityId strings without precision loss', () => {
    const bigId = '9223372036854775807';
    const parsed = UserProfileSchema.parse({
      id: bigId,
      username: 'super_ops',
      email: null,
      department: null,
      status: 'ACTIVE',
      must_change_password: false,
      password_updated_at: '2026-11-20T00:00:00.000Z',
      password_expires_days: 90,
      password_expires_at: '2027-02-18T00:00:00.000Z',
      is_password_expired: false,
      version: 2,
      roles: ['SUPER_ADMIN'],
      reject_reason: null,
      created_at: '2026-11-20T00:00:00.000Z',
    });

    expect(parsed.id).toBe(bigId);
    expect(typeof parsed.id).toBe('string');
    expect(parsed.email).toBeNull();
  });

  it('rejects numeric EntityId to prevent 64-bit integer truncation', () => {
    const result = UserProfileSchema.safeParse({
      id: 1001,
      username: 'numeric_id',
      email: null,
      department: null,
      status: 'ACTIVE',
      must_change_password: false,
      password_updated_at: '2026-11-20T00:00:00.000Z',
      password_expires_days: 90,
      password_expires_at: '2027-02-18T00:00:00.000Z',
      is_password_expired: false,
      version: 1,
      roles: ['DEVELOPER'],
      reject_reason: null,
      created_at: '2026-11-20T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('parses minimal RestrictedUserProfileDTO for PENDING, REJECTED, and DISABLED statuses', () => {
    for (const status of ['PENDING', 'REJECTED', 'DISABLED'] as const) {
      const parsed = CurrentUserResponseSchema.parse({
        id: '9007199254740993123',
        username: `user_${status.toLowerCase()}`,
        email: null,
        department: 'SecOps',
        status,
        reject_reason: status === 'REJECTED' ? '请补充业务审批单号' : null,
        created_at: '2026-11-20T00:00:00.000Z',
      });
      expect(parsed.status).toBe(status);
      expect(parsed.id).toBe('9007199254740993123');
    }
  });

  it('validates PasswordPolicySchema and UpdatePasswordPolicyRequestSchema bounds (30..180 or null)', () => {
    const disabledPolicy = PasswordPolicySchema.parse({
      passwordExpiresDays: null,
      passwordExpiresAt: null,
      isExpirationEnabled: false,
      daysRemaining: -1,
      isExpired: false,
      minDays: 30,
      maxDays: 180,
    });
    expect(disabledPolicy.daysRemaining).toBe(-1);

    expect(UpdatePasswordPolicyRequestSchema.safeParse({ passwordExpiresDays: null }).success).toBe(
      true,
    );
    expect(UpdatePasswordPolicyRequestSchema.safeParse({ passwordExpiresDays: 30 }).success).toBe(
      true,
    );
    expect(UpdatePasswordPolicyRequestSchema.safeParse({ passwordExpiresDays: 180 }).success).toBe(
      true,
    );
    expect(UpdatePasswordPolicyRequestSchema.safeParse({ passwordExpiresDays: 29 }).success).toBe(
      false,
    );
    expect(UpdatePasswordPolicyRequestSchema.safeParse({ passwordExpiresDays: 181 }).success).toBe(
      false,
    );
  });

  it('enforces strong password policy on registration requests', () => {
    expect(
      RegisterRequestSchema.safeParse({
        username: 'dev_user',
        password: 'weakpassword',
      }).success,
    ).toBe(false);

    expect(
      RegisterRequestSchema.safeParse({
        username: 'dev_user',
        password: 'StrongPassword1!',
        email: null,
      }).success,
    ).toBe(true);
  });
});
