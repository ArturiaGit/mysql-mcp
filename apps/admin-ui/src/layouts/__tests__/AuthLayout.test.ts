import { describe, expect, it } from 'vitest';
import { getAuthTopbarStatusPresentation } from '../AuthLayout';

describe('AuthLayout topbar user status presentation', () => {
  it('maps every UserStatus to Chinese label, raw English title, and AuthLayout semantic variant', () => {
    expect(getAuthTopbarStatusPresentation('ACTIVE')).toEqual({
      label: '活跃',
      title: 'ACTIVE',
      variant: 'safe',
    });
    expect(getAuthTopbarStatusPresentation('PENDING')).toEqual({
      label: '待审批',
      title: 'PENDING',
      variant: 'warning',
    });
    expect(getAuthTopbarStatusPresentation('REJECTED')).toEqual({
      label: '已驳回',
      title: 'REJECTED',
      variant: 'danger',
    });
    expect(getAuthTopbarStatusPresentation('DISABLED')).toEqual({
      label: '已停用',
      title: 'DISABLED',
      variant: 'danger',
    });
  });
});
