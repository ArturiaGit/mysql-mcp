import type {
  ApproveUserRequestDTO,
  EntityId,
  RejectUserRequestDTO,
  ResetPasswordRequestDTO,
  RoleDTO,
  UpdateUserRolesRequestDTO,
  UpdateUserStatusRequestDTO,
  UserListItemDTO,
  UserStatus,
} from '@mysql-mcp/shared-types';
import * as z from 'zod/v4-mini';
import { EntityIdSchema, StrongPasswordSchema, UserStatusSchema } from './auth.schema';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;
export const REJECT_REASON_MIN_LENGTH = 1;
export const REJECT_REASON_MAX_LENGTH = 512;
export const MAX_UINT32_VERSION = 4_294_967_295;
export const ROLE_NAME_FILTER_REGEX = /^[A-Z0-9_]{1,32}$/;

export const VersionSchema = z.int('版本号须为正整数').check(
  z.gte(1, '版本号须大于等于 1'),
  z.lte(MAX_UINT32_VERSION, '版本号超出有效范围'),
);

export const PendingApprovalSchema = z.object({
  id: EntityIdSchema,
  user_id: EntityIdSchema,
  username: z.string(),
  email: z.nullable(z.string()),
  department: z.nullable(z.string()),
  reason: z.nullable(z.string()),
  created_at: z.string(),
});

export function createPaginatedSchema<T extends z.ZodMiniType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
}

export const PaginatedPendingApprovalsSchema = createPaginatedSchema(PendingApprovalSchema);

export const ApproveUserRequestSchema = z.object({
  roleIds: z.array(EntityIdSchema).check(z.minLength(1, '请至少为申请人分配 1 项角色')),
});

export const RejectUserRequestSchema = z.object({
  reason: z.string().check(
    z.refine((value) => value.trim().length >= REJECT_REASON_MIN_LENGTH, '请填写明确的驳回理由'),
    z.refine(
      (value) => value.trim().length <= REJECT_REASON_MAX_LENGTH,
      `驳回理由不能超过 ${REJECT_REASON_MAX_LENGTH} 字符`,
    ),
  ),
});

export const UserRoleSummarySchema = z.object({
  id: EntityIdSchema,
  role_name: z.string(),
  display_name: z.string(),
});

export const UserListItemSchema = z.object({
  id: EntityIdSchema,
  username: z.string(),
  email: z.nullable(z.string()),
  department: z.nullable(z.string()),
  status: UserStatusSchema,
  must_change_password: z.boolean(),
  password_expires_days: z.nullable(z.number()),
  is_password_expired: z.boolean(),
  version: z.number(),
  roles: z.array(UserRoleSummarySchema),
  is_last_super_admin: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const PaginatedUsersSchema = createPaginatedSchema(UserListItemSchema);

export const ManageableUserStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

export const UpdateUserStatusRequestSchema = z.object({
  status: ManageableUserStatusSchema,
  version: VersionSchema,
});

export const UpdateUserRolesRequestSchema = z.object({
  roleIds: z.array(EntityIdSchema),
  version: VersionSchema,
});

export const VersionedActionSuccessSchema = z.object({
  success: z.literal(true),
  version: z.number(),
});

export const ResetPasswordRequestSchema = z.object({
  newTemporaryPassword: z.optional(StrongPasswordSchema),
  mustChangePassword: z.optional(z.boolean()),
  version: VersionSchema,
});

export const ResetPasswordResponseSchema = z.object({
  success: z.literal(true),
  temporaryPassword: z.string().check(z.minLength(1)),
  version: z.number(),
});

export const RoleSchema = z.object({
  id: EntityIdSchema,
  role_name: z.string(),
  display_name: z.string(),
  description: z.nullable(z.string()),
  version: z.number(),
  default_limit: z.number(),
  max_limit: z.number(),
  max_timeout_ms: z.number(),
  user_qpm_limit: z.number(),
  max_inflight_concurrency: z.number(),
  profileIds: z.array(EntityIdSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const RoleListResponseSchema = z.array(RoleSchema);

export const ConflictErrorDetailsSchema = z.object({
  current_version: z.number(),
  submitted_version: z.number(),
});

export type PendingApprovalParsed = z.infer<typeof PendingApprovalSchema>;
export type PaginatedPendingApprovalsParsed = z.infer<typeof PaginatedPendingApprovalsSchema>;
export type ApproveUserRequestParsed = z.infer<typeof ApproveUserRequestSchema>;
export type RejectUserRequestParsed = z.infer<typeof RejectUserRequestSchema>;
export type UserRoleSummaryParsed = z.infer<typeof UserRoleSummarySchema>;
export type UserListItemParsed = z.infer<typeof UserListItemSchema>;
export type PaginatedUsersParsed = z.infer<typeof PaginatedUsersSchema>;
export type UpdateUserStatusRequestParsed = z.infer<typeof UpdateUserStatusRequestSchema>;
export type UpdateUserRolesRequestParsed = z.infer<typeof UpdateUserRolesRequestSchema>;
export type VersionedActionSuccessParsed = z.infer<typeof VersionedActionSuccessSchema>;
export type ResetPasswordRequestParsed = z.infer<typeof ResetPasswordRequestSchema>;
export type ResetPasswordResponseParsed = z.infer<typeof ResetPasswordResponseSchema>;
export type RoleParsed = z.infer<typeof RoleSchema>;
export type ConflictErrorDetailsParsed = z.infer<typeof ConflictErrorDetailsSchema>;

export interface ApprovalsSearchQuery {
  page: number;
  pageSize: number;
}

export interface UsersSearchQuery {
  page: number;
  pageSize: number;
  search: string;
  status: UserStatus | '';
  role: string;
}

function parsePositiveIntParam(
  raw: string | null,
  fallback: number,
  min: number,
  max?: number,
): number {
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return fallback;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(value) || value < min) {
    return fallback;
  }
  if (max !== undefined && value > max) {
    return max;
  }
  return value;
}

export function parseApprovalsSearchParams(params: URLSearchParams): ApprovalsSearchQuery {
  return {
    page: parsePositiveIntParam(params.get('page'), DEFAULT_PAGE, 1),
    pageSize: parsePositiveIntParam(
      params.get('pageSize'),
      DEFAULT_PAGE_SIZE,
      MIN_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
  };
}

export function buildApprovalsSearchParams(query: ApprovalsSearchQuery): URLSearchParams {
  const next = new URLSearchParams();
  if (query.page > DEFAULT_PAGE) {
    next.set('page', String(query.page));
  }
  if (query.pageSize !== DEFAULT_PAGE_SIZE) {
    next.set('pageSize', String(query.pageSize));
  }
  return next;
}

export function parseUsersSearchParams(params: URLSearchParams): UsersSearchQuery {
  const rawSearch = (params.get('search') ?? '').trim();
  const rawStatus = params.get('status') ?? '';
  const statusParsed = UserStatusSchema.safeParse(rawStatus);
  const rawRole = (params.get('role') ?? '').trim();
  const role = ROLE_NAME_FILTER_REGEX.test(rawRole) ? rawRole : '';

  return {
    page: parsePositiveIntParam(params.get('page'), DEFAULT_PAGE, 1),
    pageSize: parsePositiveIntParam(
      params.get('pageSize'),
      DEFAULT_PAGE_SIZE,
      MIN_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    search: rawSearch,
    status: statusParsed.success ? statusParsed.data : '',
    role,
  };
}

export function buildUsersSearchParams(query: UsersSearchQuery): URLSearchParams {
  const next = new URLSearchParams();
  if (query.page > DEFAULT_PAGE) {
    next.set('page', String(query.page));
  }
  if (query.pageSize !== DEFAULT_PAGE_SIZE) {
    next.set('pageSize', String(query.pageSize));
  }
  const trimmedSearch = query.search.trim();
  if (trimmedSearch.length > 0) {
    next.set('search', trimmedSearch);
  }
  if (query.status) {
    next.set('status', query.status);
  }
  if (query.role && ROLE_NAME_FILTER_REGEX.test(query.role)) {
    next.set('role', query.role);
  }
  return next;
}

export const SELF_ACTION_TOOLTIP =
  '禁止对当前登录账号自身执行停用或删除操作，以防管理权意外丢失。';
export const LAST_SUPER_ADMIN_TOOLTIP =
  '系统必须保留至少 1 名活跃超级管理员，当前账号已被保护，禁止停用、降级或删除。';
export const SELF_AND_LAST_SUPER_ADMIN_TOOLTIP =
  '禁止对当前登录账号自身执行停用或删除操作，且系统必须保留至少 1 名活跃超级管理员。';
export const SUPER_ADMIN_ROLE_LOCK_SELF_REASON =
  '禁止移除当前登录账号自身的 SUPER_ADMIN 角色，以防管理权丢失。';
export const SUPER_ADMIN_ROLE_LOCK_LAST_REASON =
  '系统必须保留至少 1 名活跃超级管理员，无法取消该账号的 SUPER_ADMIN 角色。';
export const PRIVILEGE_ESCALATION_TOOLTIP =
  '仅 SUPER_ADMIN 可授予超级管理员角色，当前角色无权分配。';

export interface UserGuardrailDecision {
  isSelf: boolean;
  isLastSuperAdmin: boolean;
  hasSuperAdminRole: boolean;
  isManageableStatus: boolean;
  canDisable: boolean;
  canEnable: boolean;
  canDelete: boolean;
  disableReason: string | null;
  deleteReason: string | null;
  superAdminRoleLocked: boolean;
  superAdminRoleLockReason: string | null;
}

/**
 * Pure guardrail evaluator for /users (FRONTEND_ARCHITECTURE_SPEC.md §4.4):
 * - Protection 1 (AntiSelfLockout): last active SUPER_ADMIN cannot be disabled, demoted, or deleted.
 * - Protection 2 (SelfActionGuard): current logged-in user cannot disable, delete, or strip own SUPER_ADMIN.
 * - Status matrix guard: PENDING / REJECTED users do not expose enable/disable controls (routed to /approvals).
 */
export function evaluateUserGuardrails(
  target: Pick<UserListItemDTO, 'id' | 'status' | 'roles' | 'is_last_super_admin'>,
  currentUserId: EntityId,
): UserGuardrailDecision {
  const isSelf = target.id === currentUserId;
  const isLastSuperAdmin = target.is_last_super_admin === true;
  const hasSuperAdminRole = target.roles.some((role) => role.role_name === 'SUPER_ADMIN');
  const isManageableStatus = target.status === 'ACTIVE' || target.status === 'DISABLED';

  let blockReason: string | null = null;
  if (isSelf && isLastSuperAdmin) {
    blockReason = SELF_AND_LAST_SUPER_ADMIN_TOOLTIP;
  } else if (isSelf) {
    blockReason = SELF_ACTION_TOOLTIP;
  } else if (isLastSuperAdmin) {
    blockReason = LAST_SUPER_ADMIN_TOOLTIP;
  }

  const canDisable = target.status === 'ACTIVE' && !isSelf && !isLastSuperAdmin;
  const canEnable = target.status === 'DISABLED';
  const canDelete = !isSelf && !isLastSuperAdmin;

  let superAdminRoleLockReason: string | null = null;
  if (hasSuperAdminRole && isSelf && isLastSuperAdmin) {
    superAdminRoleLockReason =
      '禁止移除自身 SUPER_ADMIN 角色，且系统必须保留至少 1 名活跃超级管理员。';
  } else if (hasSuperAdminRole && isSelf) {
    superAdminRoleLockReason = SUPER_ADMIN_ROLE_LOCK_SELF_REASON;
  } else if (hasSuperAdminRole && isLastSuperAdmin) {
    superAdminRoleLockReason = SUPER_ADMIN_ROLE_LOCK_LAST_REASON;
  }

  return {
    isSelf,
    isLastSuperAdmin,
    hasSuperAdminRole,
    isManageableStatus,
    canDisable,
    canEnable,
    canDelete,
    disableReason: target.status === 'ACTIVE' ? blockReason : null,
    deleteReason: blockReason,
    superAdminRoleLocked: superAdminRoleLockReason !== null,
    superAdminRoleLockReason,
  };
}

export function canAssignRole(role: Pick<RoleDTO, 'role_name'>, actorIsSuperAdmin: boolean): boolean {
  if (role.role_name === 'SUPER_ADMIN' && !actorIsSuperAdmin) {
    return false;
  }
  return true;
}

export function validateApproveRolesSelection(
  selectedRoleIds: readonly EntityId[],
  availableRoles: readonly RoleDTO[],
  actorIsSuperAdmin: boolean,
): { payload?: ApproveUserRequestDTO; error: string } {
  const uniqueIds = Array.from(new Set(selectedRoleIds));
  if (uniqueIds.length === 0) {
    return { error: '请至少选择 1 项初始角色后再批准申请。' };
  }

  const roleMap = new Map(availableRoles.map((role) => [role.id, role]));
  for (const id of uniqueIds) {
    const role = roleMap.get(id);
    if (!role) {
      return { error: '所选角色列表包含无效角色，请刷新角色目录后重试。' };
    }
    if (!canAssignRole(role, actorIsSuperAdmin)) {
      return { error: PRIVILEGE_ESCALATION_TOOLTIP };
    }
  }

  const checked = ApproveUserRequestSchema.safeParse({ roleIds: uniqueIds });
  if (!checked.success) {
    return { error: checked.error.issues[0]?.message ?? '角色参数无效。' };
  }
  return { payload: checked.data, error: '' };
}

export function validateRejectReasonInput(
  rawReason: string,
): { payload?: RejectUserRequestDTO; error: string } {
  const trimmed = rawReason.trim();
  if (trimmed.length < REJECT_REASON_MIN_LENGTH) {
    return { error: '驳回理由不能为空，请说明具体原因或补充指引（1~512 字符）。' };
  }
  if (trimmed.length > REJECT_REASON_MAX_LENGTH) {
    return { error: `驳回理由不能超过 ${REJECT_REASON_MAX_LENGTH} 字符。` };
  }
  const checked = RejectUserRequestSchema.safeParse({ reason: trimmed });
  if (!checked.success) {
    return { error: checked.error.issues[0]?.message ?? '驳回理由格式无效。' };
  }
  return { payload: { reason: trimmed }, error: '' };
}

export function buildUpdateUserRolesPayload(
  selectedRoleIds: readonly EntityId[],
  version: number,
): { payload?: UpdateUserRolesRequestDTO; error: string } {
  const uniqueIds = Array.from(new Set(selectedRoleIds));
  const checked = UpdateUserRolesRequestSchema.safeParse({ roleIds: uniqueIds, version });
  if (!checked.success) {
    return { error: checked.error.issues[0]?.message ?? '角色更新参数无效。' };
  }
  return { payload: checked.data, error: '' };
}

export function buildUpdateUserStatusPayload(
  status: 'ACTIVE' | 'DISABLED',
  version: number,
): { payload?: UpdateUserStatusRequestDTO; error: string } {
  const checked = UpdateUserStatusRequestSchema.safeParse({ status, version });
  if (!checked.success) {
    return { error: checked.error.issues[0]?.message ?? '状态变更参数无效。' };
  }
  return { payload: checked.data, error: '' };
}

export type ResetPasswordMode = 'auto' | 'manual';

export interface ResetPasswordDraft {
  mode: ResetPasswordMode;
  manualPassword: string;
  mustChangePassword: boolean;
  version: number;
}

export function validateResetPasswordDraft(
  draft: ResetPasswordDraft,
): { payload?: ResetPasswordRequestDTO; passwordError: string } {
  if (draft.mode === 'manual') {
    if (draft.manualPassword.length === 0) {
      return { passwordError: '请输入自定义临时密码，或切换为服务端自动生成。' };
    }
    const pwdChecked = StrongPasswordSchema.safeParse(draft.manualPassword);
    if (!pwdChecked.success) {
      return {
        passwordError:
          pwdChecked.error.issues[0]?.message ??
          '临时密码须为 8~64 位，且包含大小写字母、数字与特殊符号。',
      };
    }
  }

  const candidate: ResetPasswordRequestDTO = {
    mustChangePassword: draft.mustChangePassword,
    version: draft.version,
    ...(draft.mode === 'manual' ? { newTemporaryPassword: draft.manualPassword } : {}),
  };

  const checked = ResetPasswordRequestSchema.safeParse(candidate);
  if (!checked.success) {
    return {
      passwordError: checked.error.issues[0]?.message ?? '重置密码请求参数无效。',
    };
  }
  return { payload: checked.data, passwordError: '' };
}
