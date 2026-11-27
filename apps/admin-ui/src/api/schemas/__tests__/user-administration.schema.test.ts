import type { RoleDTO, UserListItemDTO } from '@mysql-mcp/shared-types';
import { describe, expect, it } from 'vitest';
import {
  buildApprovalsSearchParams,
  buildUpdateUserRolesPayload,
  buildUpdateUserStatusPayload,
  buildUsersSearchParams,
  canAssignRole,
  evaluateUserGuardrails,
  LAST_SUPER_ADMIN_TOOLTIP,
  PaginatedPendingApprovalsSchema,
  PaginatedUsersSchema,
  parseApprovalsSearchParams,
  parseUsersSearchParams,
  PRIVILEGE_ESCALATION_TOOLTIP,
  ResetPasswordResponseSchema,
  RoleListResponseSchema,
  SELF_ACTION_TOOLTIP,
  SELF_AND_LAST_SUPER_ADMIN_TOOLTIP,
  validateApproveRolesSelection,
  validateRejectReasonInput,
  validateResetPasswordDraft,
} from '../user-administration.schema';

const MOCK_ROLES: RoleDTO[] = [
  {
    id: '1',
    role_name: 'SUPER_ADMIN',
    display_name: '超级管理员',
    description: '全平台最高治理权限',
    version: 1,
    default_limit: 500,
    max_limit: 5000,
    max_timeout_ms: 30000,
    user_qpm_limit: 300,
    max_inflight_concurrency: 10,
    profileIds: [],
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
  },
  {
    id: '90071992547409931',
    role_name: 'DEVELOPER',
    display_name: '研发工程师',
    description: '标准只读查询角色',
    version: 1,
    default_limit: 100,
    max_limit: 1000,
    max_timeout_ms: 10000,
    user_qpm_limit: 60,
    max_inflight_concurrency: 4,
    profileIds: ['90071992547409955'],
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
  },
];

function makeUser(overrides: Partial<UserListItemDTO> = {}): UserListItemDTO {
  return {
    id: '90071992547409999',
    username: 'admin',
    email: 'admin@example.com',
    department: '安全架构部',
    status: 'ACTIVE',
    must_change_password: false,
    password_expires_days: 90,
    is_password_expired: false,
    version: 3,
    roles: [{ id: '1', role_name: 'SUPER_ADMIN', display_name: '超级管理员' }],
    is_last_super_admin: false,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('user-administration response schemas (64-bit string EntityId preservation)', () => {
  it('parses paginated approvals, users, roles, and reset-password responses preserving 64-bit string IDs', () => {
    const approvals = PaginatedPendingApprovalsSchema.safeParse({
      items: [
        {
          id: '18446744073709551610',
          user_id: '90071992547409999',
          username: 'lisi',
          email: null,
          department: '风控数据组',
          reason: '申请接入只读库',
          created_at: '2026-11-08T07:15:30.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(approvals.success).toBe(true);
    if (approvals.success) {
      expect(approvals.data.items[0]?.id).toBe('18446744073709551610');
      expect(approvals.data.items[0]?.user_id).toBe('90071992547409999');
    }

    const users = PaginatedUsersSchema.safeParse({
      items: [makeUser({ is_last_super_admin: true })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(users.success).toBe(true);

    const roles = RoleListResponseSchema.safeParse(MOCK_ROLES);
    expect(roles.success).toBe(true);
    if (roles.success) {
      expect(roles.data[1]?.id).toBe('90071992547409931');
    }

    const reset = ResetPasswordResponseSchema.safeParse({
      success: true,
      temporaryPassword: 'TempPassword2026!#',
      version: 4,
    });
    expect(reset.success).toBe(true);
  });

  it('rejects numeric IDs where decimal string EntityId is required', () => {
    const bad = PaginatedPendingApprovalsSchema.safeParse({
      items: [
        {
          id: 5001,
          user_id: '1002',
          username: 'lisi',
          email: null,
          department: null,
          reason: null,
          created_at: '2026-11-08T07:15:30.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(bad.success).toBe(false);
  });
});

describe('URL SearchParams SSOT parsing & serialization', () => {
  it('parses and clamps approvals pagination params cleanly', () => {
    expect(parseApprovalsSearchParams(new URLSearchParams(''))).toEqual({ page: 1, pageSize: 20 });
    expect(parseApprovalsSearchParams(new URLSearchParams('page=3&pageSize=50'))).toEqual({
      page: 3,
      pageSize: 50,
    });
    expect(parseApprovalsSearchParams(new URLSearchParams('page=-1&pageSize=500'))).toEqual({
      page: 1,
      pageSize: 100,
    });
    expect(buildApprovalsSearchParams({ page: 1, pageSize: 20 }).toString()).toBe('');
    expect(buildApprovalsSearchParams({ page: 2, pageSize: 50 }).toString()).toBe(
      'page=2&pageSize=50',
    );
  });

  it('parses users search, status, role, and pagination params while ignoring invalid values', () => {
    const parsed = parseUsersSearchParams(
      new URLSearchParams('page=2&pageSize=10&search=alice&status=DISABLED&role=SUPER_ADMIN'),
    );
    expect(parsed).toEqual({
      page: 2,
      pageSize: 10,
      search: 'alice',
      status: 'DISABLED',
      role: 'SUPER_ADMIN',
    });

    const sanitized = parseUsersSearchParams(
      new URLSearchParams('page=abc&status=UNKNOWN&role=bad-role!'),
    );
    expect(sanitized).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: '',
      role: '',
    });

    expect(buildUsersSearchParams(parsed).toString()).toBe(
      'page=2&pageSize=10&search=alice&status=DISABLED&role=SUPER_ADMIN',
    );
  });
});

describe('AntiSelfLockout, SelfActionGuard & Privilege Escalation guardrails (§4.4)', () => {
  it('locks disable, delete, and SUPER_ADMIN removal when target is both self and last SUPER_ADMIN', () => {
    const target = makeUser({ id: '1', is_last_super_admin: true });
    const decision = evaluateUserGuardrails(target, '1');

    expect(decision.isSelf).toBe(true);
    expect(decision.isLastSuperAdmin).toBe(true);
    expect(decision.canDisable).toBe(false);
    expect(decision.canDelete).toBe(false);
    expect(decision.disableReason).toBe(SELF_AND_LAST_SUPER_ADMIN_TOOLTIP);
    expect(decision.deleteReason).toBe(SELF_AND_LAST_SUPER_ADMIN_TOOLTIP);
    expect(decision.superAdminRoleLocked).toBe(true);
  });

  it('locks disable, delete, and own SUPER_ADMIN removal for current user even when other super admins exist', () => {
    const target = makeUser({ id: '1', is_last_super_admin: false });
    const decision = evaluateUserGuardrails(target, '1');

    expect(decision.isSelf).toBe(true);
    expect(decision.isLastSuperAdmin).toBe(false);
    expect(decision.canDisable).toBe(false);
    expect(decision.canDelete).toBe(false);
    expect(decision.disableReason).toBe(SELF_ACTION_TOOLTIP);
    expect(decision.deleteReason).toBe(SELF_ACTION_TOOLTIP);
    expect(decision.superAdminRoleLocked).toBe(true);
  });

  it('locks disable, delete, and SUPER_ADMIN removal for another user who is the last active SUPER_ADMIN', () => {
    const target = makeUser({ id: '2', is_last_super_admin: true });
    const decision = evaluateUserGuardrails(target, '1');

    expect(decision.isSelf).toBe(false);
    expect(decision.isLastSuperAdmin).toBe(true);
    expect(decision.canDisable).toBe(false);
    expect(decision.canDelete).toBe(false);
    expect(decision.disableReason).toBe(LAST_SUPER_ADMIN_TOOLTIP);
    expect(decision.deleteReason).toBe(LAST_SUPER_ADMIN_TOOLTIP);
    expect(decision.superAdminRoleLocked).toBe(true);
  });

  it('disables status toggle controls for PENDING and REJECTED users (must go through /approvals)', () => {
    const pending = evaluateUserGuardrails(
      makeUser({ id: '3', status: 'PENDING', roles: [] }),
      '1',
    );
    expect(pending.isManageableStatus).toBe(false);
    expect(pending.canDisable).toBe(false);
    expect(pending.canEnable).toBe(false);
    expect(pending.canDelete).toBe(true);

    const rejected = evaluateUserGuardrails(
      makeUser({ id: '4', status: 'REJECTED', roles: [] }),
      '1',
    );
    expect(rejected.isManageableStatus).toBe(false);
    expect(rejected.canDisable).toBe(false);
    expect(rejected.canEnable).toBe(false);
  });

  it('allows full lifecycle actions for ordinary ACTIVE or DISABLED non-self users', () => {
    const activeDev = evaluateUserGuardrails(
      makeUser({
        id: '10',
        status: 'ACTIVE',
        roles: [{ id: '90071992547409931', role_name: 'DEVELOPER', display_name: '研发工程师' }],
        is_last_super_admin: false,
      }),
      '1',
    );
    expect(activeDev.canDisable).toBe(true);
    expect(activeDev.canDelete).toBe(true);
    expect(activeDev.superAdminRoleLocked).toBe(false);

    const disabledDev = evaluateUserGuardrails(
      makeUser({
        id: '11',
        status: 'DISABLED',
        roles: [{ id: '90071992547409931', role_name: 'DEVELOPER', display_name: '研发工程师' }],
        is_last_super_admin: false,
      }),
      '1',
    );
    expect(disabledDev.canEnable).toBe(true);
    expect(disabledDev.canDisable).toBe(false);
    expect(disabledDev.canDelete).toBe(true);
  });

  it('prevents non-SUPER_ADMIN from assigning SUPER_ADMIN role during approval', () => {
    expect(canAssignRole({ role_name: 'SUPER_ADMIN' }, false)).toBe(false);
    expect(canAssignRole({ role_name: 'SUPER_ADMIN' }, true)).toBe(true);
    expect(canAssignRole({ role_name: 'DEVELOPER' }, false)).toBe(true);

    const escalation = validateApproveRolesSelection(['1'], MOCK_ROLES, false);
    expect(escalation.payload).toBeUndefined();
    expect(escalation.error).toBe(PRIVILEGE_ESCALATION_TOOLTIP);

    const empty = validateApproveRolesSelection([], MOCK_ROLES, true);
    expect(empty.payload).toBeUndefined();
    expect(empty.error).toContain('至少选择 1 项');

    const ok = validateApproveRolesSelection(['90071992547409931'], MOCK_ROLES, false);
    expect(ok.error).toBe('');
    expect(ok.payload).toEqual({ roleIds: ['90071992547409931'] });
  });
});

describe('Approval reject & user mutation form validators', () => {
  it('blocks empty or whitespace-only reject reason and enforces 512 char cap', () => {
    expect(validateRejectReasonInput('').payload).toBeUndefined();
    expect(validateRejectReasonInput('   \t\n  ').payload).toBeUndefined();
    expect(validateRejectReasonInput('a'.repeat(513)).payload).toBeUndefined();
    expect(validateRejectReasonInput('  请补充 OA 审批单号  ')).toEqual({
      payload: { reason: '请补充 OA 审批单号' },
      error: '',
    });
  });

  it('builds explicit role & status update payloads with optimistic lock version', () => {
    expect(buildUpdateUserRolesPayload(['90071992547409931', '90071992547409931'], 5)).toEqual({
      payload: { roleIds: ['90071992547409931'], version: 5 },
      error: '',
    });
    expect(buildUpdateUserStatusPayload('DISABLED', 2)).toEqual({
      payload: { status: 'DISABLED', version: 2 },
      error: '',
    });
  });

  it('validates auto and manual reset-password drafts without leaking empty password field in auto mode', () => {
    const auto = validateResetPasswordDraft({
      mode: 'auto',
      manualPassword: '',
      mustChangePassword: true,
      version: 3,
    });
    expect(auto.passwordError).toBe('');
    expect(auto.payload).toEqual({ mustChangePassword: true, version: 3 });
    expect('newTemporaryPassword' in (auto.payload ?? {})).toBe(false);

    const weakManual = validateResetPasswordDraft({
      mode: 'manual',
      manualPassword: 'weak',
      mustChangePassword: false,
      version: 3,
    });
    expect(weakManual.payload).toBeUndefined();
    expect(weakManual.passwordError.length).toBeGreaterThan(0);

    const strongManual = validateResetPasswordDraft({
      mode: 'manual',
      manualPassword: 'StrongTemp#2026',
      mustChangePassword: false,
      version: 3,
    });
    expect(strongManual.passwordError).toBe('');
    expect(strongManual.payload).toEqual({
      newTemporaryPassword: 'StrongTemp#2026',
      mustChangePassword: false,
      version: 3,
    });
  });
});
