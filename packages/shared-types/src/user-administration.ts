import type { ActionSuccessDTO } from './auth.js';
import type { EntityId, UserStatus } from './index.js';

export interface PaginatedDTO<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PendingApprovalDTO {
  id: EntityId;
  user_id: EntityId;
  username: string;
  email: string | null;
  department: string | null;
  reason: string | null;
  created_at: string;
}

export interface ApproveUserRequestDTO { roleIds: EntityId[]; }
export interface RejectUserRequestDTO { reason: string; }

export interface UserRoleSummaryDTO {
  id: EntityId;
  role_name: string;
  display_name: string;
}

export interface UserListItemDTO {
  id: EntityId;
  username: string;
  email: string | null;
  department: string | null;
  status: UserStatus;
  must_change_password: boolean;
  password_expires_days: number | null;
  is_password_expired: boolean;
  version: number;
  roles: UserRoleSummaryDTO[];
  is_last_super_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserStatusRequestDTO {
  status: Extract<UserStatus, 'ACTIVE' | 'DISABLED'>;
  version: number;
}

export interface UpdateUserRolesRequestDTO { roleIds: EntityId[]; version: number; }
export interface VersionedActionSuccessDTO extends ActionSuccessDTO { version: number; }

export interface ResetPasswordRequestDTO {
  newTemporaryPassword?: string;
  mustChangePassword?: boolean;
  version: number;
}

export interface ResetPasswordResponseDTO extends VersionedActionSuccessDTO { temporaryPassword: string; }

export interface RoleDTO extends UserRoleSummaryDTO {
  description: string | null;
  version: number;
  default_limit: number;
  max_limit: number;
  max_timeout_ms: number;
  user_qpm_limit: number;
  max_inflight_concurrency: number;
  profileIds: EntityId[];
  created_at: string;
  updated_at: string;
}

export interface ConflictErrorDetailsDTO { current_version: number; submitted_version: number; }
