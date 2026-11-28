import type { UserStatus } from '@mysql-mcp/shared-types';

export type StatusBadgeVariant = 'safe' | 'danger' | 'warning' | 'neutral';

export interface UserStatusMeta {
  code: UserStatus;
  label: string;
  filterOptionLabel: string;
  variant: StatusBadgeVariant;
}

export const USER_STATUS_META: Readonly<Record<UserStatus, UserStatusMeta>> = {
  ACTIVE: {
    code: 'ACTIVE',
    label: '活跃',
    filterOptionLabel: '活跃 (ACTIVE)',
    variant: 'safe',
  },
  DISABLED: {
    code: 'DISABLED',
    label: '已停用',
    filterOptionLabel: '已停用 (DISABLED)',
    variant: 'danger',
  },
  PENDING: {
    code: 'PENDING',
    label: '待审批',
    filterOptionLabel: '待审批 (PENDING)',
    variant: 'warning',
  },
  REJECTED: {
    code: 'REJECTED',
    label: '已驳回',
    filterOptionLabel: '已驳回 (REJECTED)',
    variant: 'neutral',
  },
};

export const USER_STATUS_ORDER: readonly UserStatus[] = [
  'ACTIVE',
  'DISABLED',
  'PENDING',
  'REJECTED',
];

export function getUserStatusMeta(status: UserStatus): UserStatusMeta {
  return USER_STATUS_META[status];
}

export function getUserStatusLabel(status: UserStatus): string {
  return USER_STATUS_META[status].label;
}

export function formatRoleDisplayLabel(role: {
  role_name: string;
  display_name?: string | null;
}): string {
  const displayName = role.display_name?.trim();
  return displayName && displayName.length > 0 ? displayName : role.role_name;
}
