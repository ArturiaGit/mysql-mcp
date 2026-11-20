import type { CurrentUserResponseDTO } from '@mysql-mcp/shared-types';
import { describe, expect, it } from 'vitest';
import { evaluateGuardPipeline, postLoginRedirectPath } from '../guard-decision';

const activeNormalUser: CurrentUserResponseDTO = {
  id: '1',
  username: 'admin',
  email: 'admin@example.test',
  department: 'SecOps',
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
};

const activeDeveloper: CurrentUserResponseDTO = {
  ...activeNormalUser,
  id: '2',
  username: 'dev_bob',
  roles: ['DEVELOPER'],
};

const pendingUser: CurrentUserResponseDTO = {
  id: '3',
  username: 'pending_alice',
  email: null,
  department: 'AI',
  status: 'PENDING',
  reject_reason: null,
  created_at: '2026-11-20T00:00:00.000Z',
};

const rejectedUser: CurrentUserResponseDTO = {
  ...pendingUser,
  id: '4',
  username: 'rejected_carol',
  status: 'REJECTED',
  reject_reason: '请补充审批单号',
};

const disabledUser: CurrentUserResponseDTO = {
  ...pendingUser,
  id: '5',
  username: 'disabled_dave',
  status: 'DISABLED',
};

describe('4-layer guard pipeline: AuthGuard -> StatusGuard -> MustChangePwdGuard -> RoleGuard', () => {
  it('L1 redirects unauthenticated users to /login with sanitized returnUrl', () => {
    expect(evaluateGuardPipeline(null, { currentPath: '/audits?status=SUCCESS' })).toEqual({
      kind: 'redirect',
      to: '/login?returnUrl=%2Faudits%3Fstatus%3DSUCCESS',
      stage: 'L1_AUTH',
    });

    expect(evaluateGuardPipeline(null, { currentPath: '/a/..//evil.com/x' })).toEqual({
      kind: 'redirect',
      to: '/login',
      stage: 'L1_AUTH',
    });
  });

  it('L2 strictly intercepts PENDING/REJECTED/DISABLED and NEVER triggers MustChangePwdGuard', () => {
    expect(evaluateGuardPipeline(pendingUser, { currentPath: '/dashboard' })).toEqual({
      kind: 'redirect',
      to: '/approvals/wait',
      stage: 'L2_STATUS',
    });
    expect(evaluateGuardPipeline(pendingUser, { currentPath: '/change-password' })).toEqual({
      kind: 'redirect',
      to: '/approvals/wait',
      stage: 'L2_STATUS',
    });

    expect(evaluateGuardPipeline(rejectedUser, { currentPath: '/dashboard' })).toEqual({
      kind: 'redirect',
      to: '/approvals/re',
      stage: 'L2_STATUS',
    });

    expect(evaluateGuardPipeline(disabledUser, { currentPath: '/dashboard' })).toEqual({
      kind: 'redirect',
      to: '/forbidden',
      stage: 'L2_STATUS',
    });

    // Restricted users are allowed ONLY on their matching status route
    expect(
      evaluateGuardPipeline(pendingUser, {
        currentPath: '/approvals/wait',
        allowedStatuses: ['PENDING'],
      }),
    ).toEqual({ kind: 'allow' });
    expect(
      evaluateGuardPipeline(rejectedUser, {
        currentPath: '/approvals/re',
        allowedStatuses: ['REJECTED'],
      }),
    ).toEqual({ kind: 'allow' });
    expect(
      evaluateGuardPipeline(disabledUser, {
        currentPath: '/forbidden',
        allowedStatuses: ['DISABLED'],
      }),
    ).toEqual({ kind: 'allow' });
  });

  it('L3 locks ACTIVE users with must_change_password=true or is_password_expired=true to /change-password', () => {
    const mustChange: CurrentUserResponseDTO = {
      ...activeNormalUser,
      must_change_password: true,
    };
    expect(
      evaluateGuardPipeline(mustChange, {
        currentPath: '/audits',
        requiredRoles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
      }),
    ).toEqual({
      kind: 'redirect',
      to: '/change-password',
      stage: 'L3_MUST_CHANGE_PWD',
    });

    const expired: CurrentUserResponseDTO = {
      ...activeNormalUser,
      is_password_expired: true,
    };
    expect(evaluateGuardPipeline(expired, { currentPath: '/dashboard' })).toEqual({
      kind: 'redirect',
      to: '/change-password',
      stage: 'L3_MUST_CHANGE_PWD',
    });

    // /change-password itself is allowed for ACTIVE users
    expect(
      evaluateGuardPipeline(mustChange, {
        currentPath: '/change-password',
        allowedStatuses: ['ACTIVE'],
        bypassPasswordGuard: true,
      }),
    ).toEqual({ kind: 'allow' });
  });

  it('L4 enforces SystemRole RBAC only for ACTIVE password-valid users', () => {
    expect(
      evaluateGuardPipeline(activeNormalUser, {
        currentPath: '/audits',
        requiredRoles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
      }),
    ).toEqual({ kind: 'allow' });

    expect(
      evaluateGuardPipeline(activeDeveloper, {
        currentPath: '/audits',
        requiredRoles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
      }),
    ).toEqual({
      kind: 'forbidden',
      stage: 'L4_ROLE',
      requiredRoles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
    });
  });

  it('computes safe post-login redirect targets respecting L2, L3, and sanitizeReturnUrl', () => {
    expect(postLoginRedirectPath(pendingUser, '/audits')).toBe('/approvals/wait');
    expect(postLoginRedirectPath(rejectedUser, '/audits')).toBe('/approvals/re');
    expect(postLoginRedirectPath(disabledUser, '/audits')).toBe('/forbidden');
    expect(
      postLoginRedirectPath({ ...activeNormalUser, must_change_password: true }, '/audits'),
    ).toBe('/change-password');
    expect(postLoginRedirectPath(activeNormalUser, '/audits?status=SUCCESS')).toBe(
      '/audits?status=SUCCESS',
    );
    expect(postLoginRedirectPath(activeNormalUser, String.raw`/\evil.org/steal`)).toBe(
      '/dashboard',
    );
  });
});
