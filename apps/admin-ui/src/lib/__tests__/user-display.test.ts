import { describe, expect, it } from 'vitest';
import {
  formatRoleDisplayLabel,
  getUserStatusLabel,
  getUserStatusMeta,
  USER_STATUS_ORDER,
} from '../user-display';

describe('user-display helpers', () => {
  it('maps every UserStatus to Chinese label, semantic variant, and consistent filter option text', () => {
    expect(USER_STATUS_ORDER).toEqual(['ACTIVE', 'DISABLED', 'PENDING', 'REJECTED']);

    expect(getUserStatusMeta('ACTIVE')).toEqual({
      code: 'ACTIVE',
      label: '活跃',
      filterOptionLabel: '活跃 (ACTIVE)',
      variant: 'safe',
    });
    expect(getUserStatusMeta('DISABLED')).toEqual({
      code: 'DISABLED',
      label: '已停用',
      filterOptionLabel: '已停用 (DISABLED)',
      variant: 'danger',
    });
    expect(getUserStatusMeta('PENDING')).toEqual({
      code: 'PENDING',
      label: '待审批',
      filterOptionLabel: '待审批 (PENDING)',
      variant: 'warning',
    });
    expect(getUserStatusMeta('REJECTED')).toEqual({
      code: 'REJECTED',
      label: '已驳回',
      filterOptionLabel: '已驳回 (REJECTED)',
      variant: 'neutral',
    });

    expect(getUserStatusLabel('ACTIVE')).toBe('活跃');
    expect(getUserStatusLabel('PENDING')).toBe('待审批');
    expect(getUserStatusLabel('REJECTED')).toBe('已驳回');
    expect(getUserStatusLabel('DISABLED')).toBe('已停用');
  });

  it('prefers trimmed display_name and falls back to role_name when missing or blank', () => {
    expect(
      formatRoleDisplayLabel({ role_name: 'SUPER_ADMIN', display_name: '超级管理员' }),
    ).toBe('超级管理员');
    expect(
      formatRoleDisplayLabel({ role_name: 'DEVELOPER', display_name: '  业务研发人员  ' }),
    ).toBe('业务研发人员');
    expect(formatRoleDisplayLabel({ role_name: 'ANALYST', display_name: '' })).toBe('ANALYST');
    expect(formatRoleDisplayLabel({ role_name: 'DBA', display_name: '   ' })).toBe('DBA');
    expect(formatRoleDisplayLabel({ role_name: 'SECURITY_ADMIN', display_name: null })).toBe(
      'SECURITY_ADMIN',
    );
  });
});
