import type {
  ActionSuccessDTO,
  ApproveUserRequestDTO,
  EntityId,
  PaginatedDTO,
  PendingApprovalDTO,
  RejectUserRequestDTO,
  ResetPasswordRequestDTO,
  ResetPasswordResponseDTO,
  RoleDTO,
  UpdateUserRolesRequestDTO,
  UpdateUserStatusRequestDTO,
  UserListItemDTO,
  VersionedActionSuccessDTO,
} from '@mysql-mcp/shared-types';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';
import { ActionSuccessSchema } from './schemas/auth.schema';
import {
  PaginatedPendingApprovalsSchema,
  PaginatedUsersSchema,
  ResetPasswordResponseSchema,
  RoleListResponseSchema,
  VersionedActionSuccessSchema,
  type ApprovalsSearchQuery,
  type UsersSearchQuery,
} from './schemas/user-administration.schema';

export function rolesCatalogQueryKey(userId: EntityId | null | undefined) {
  return ['governance', userId ?? 'anonymous', 'roles'] as const;
}

export function pendingApprovalsQueryKey(
  userId: EntityId | null | undefined,
  query?: ApprovalsSearchQuery,
) {
  return query
    ? (['governance', userId ?? 'anonymous', 'approvals', 'pending', query.page, query.pageSize] as const)
    : (['governance', userId ?? 'anonymous', 'approvals', 'pending'] as const);
}

export function usersListQueryKey(
  userId: EntityId | null | undefined,
  query?: UsersSearchQuery,
) {
  return query
    ? ([
        'governance',
        userId ?? 'anonymous',
        'users',
        query.page,
        query.pageSize,
        query.search,
        query.status,
        query.role,
      ] as const)
    : (['governance', userId ?? 'anonymous', 'users'] as const);
}

export async function fetchRolesCatalog(signal?: AbortSignal): Promise<RoleDTO[]> {
  return apiRequest<RoleDTO[]>('/api/v1/roles', {
    method: 'GET',
    schema: RoleListResponseSchema,
    signal,
  });
}

export async function fetchPendingApprovals(
  query: ApprovalsSearchQuery,
  signal?: AbortSignal,
): Promise<PaginatedDTO<PendingApprovalDTO>> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  return apiRequest<PaginatedDTO<PendingApprovalDTO>>(
    `/api/v1/approvals/pending?${params.toString()}`,
    {
      method: 'GET',
      schema: PaginatedPendingApprovalsSchema,
      signal,
    },
  );
}

export async function approvePendingUser(
  approvalId: EntityId,
  payload: ApproveUserRequestDTO,
): Promise<ActionSuccessDTO> {
  return apiRequest<ActionSuccessDTO>(
    `/api/v1/approvals/${encodeURIComponent(approvalId)}/approve`,
    {
      method: 'POST',
      body: {
        roleIds: [...payload.roleIds],
      },
      schema: ActionSuccessSchema,
    },
  );
}

export async function rejectPendingUser(
  approvalId: EntityId,
  payload: RejectUserRequestDTO,
): Promise<ActionSuccessDTO> {
  return apiRequest<ActionSuccessDTO>(
    `/api/v1/approvals/${encodeURIComponent(approvalId)}/reject`,
    {
      method: 'POST',
      body: {
        reason: payload.reason.trim(),
      },
      schema: ActionSuccessSchema,
    },
  );
}

export async function fetchUsersList(
  query: UsersSearchQuery,
  signal?: AbortSignal,
): Promise<PaginatedDTO<UserListItemDTO>> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  const trimmedSearch = query.search.trim();
  if (trimmedSearch.length > 0) {
    params.set('search', trimmedSearch);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.role) {
    params.set('role', query.role);
  }

  return apiRequest<PaginatedDTO<UserListItemDTO>>(`/api/v1/users?${params.toString()}`, {
    method: 'GET',
    schema: PaginatedUsersSchema,
    signal,
  });
}

export async function updateUserStatus(
  userId: EntityId,
  payload: UpdateUserStatusRequestDTO,
): Promise<VersionedActionSuccessDTO> {
  return apiRequest<VersionedActionSuccessDTO>(
    `/api/v1/users/${encodeURIComponent(userId)}/status`,
    {
      method: 'PUT',
      body: {
        status: payload.status,
        version: payload.version,
      },
      schema: VersionedActionSuccessSchema,
    },
  );
}

export async function updateUserRoles(
  userId: EntityId,
  payload: UpdateUserRolesRequestDTO,
): Promise<VersionedActionSuccessDTO> {
  return apiRequest<VersionedActionSuccessDTO>(
    `/api/v1/users/${encodeURIComponent(userId)}/roles`,
    {
      method: 'PUT',
      body: {
        roleIds: [...payload.roleIds],
        version: payload.version,
      },
      schema: VersionedActionSuccessSchema,
    },
  );
}

export async function deleteUserAccount(userId: EntityId): Promise<ActionSuccessDTO> {
  return apiRequest<ActionSuccessDTO>(`/api/v1/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    schema: ActionSuccessSchema,
  });
}

/**
 * Imperative admin password reset call.
 * SECURITY: Never store the returned `temporaryPassword` in React Query, Zustand,
 * localStorage, sessionStorage, or logs. Keep it strictly inside local component state
 * and wipe it immediately when the modal closes or unmounts.
 */
export async function resetUserPassword(
  userId: EntityId,
  payload: ResetPasswordRequestDTO,
): Promise<ResetPasswordResponseDTO> {
  return apiRequest<ResetPasswordResponseDTO>(
    `/api/v1/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'POST',
      body: {
        ...(payload.newTemporaryPassword !== undefined
          ? { newTemporaryPassword: payload.newTemporaryPassword }
          : {}),
        ...(payload.mustChangePassword !== undefined
          ? { mustChangePassword: payload.mustChangePassword }
          : {}),
        version: payload.version,
      },
      schema: ResetPasswordResponseSchema,
    },
  );
}

export function useRolesCatalog(userId: EntityId | null | undefined) {
  const enabled = typeof userId === 'string' && userId.length > 0;
  return useQuery({
    queryKey: rolesCatalogQueryKey(userId),
    queryFn: ({ signal }) => fetchRolesCatalog(signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function usePendingApprovals(
  userId: EntityId | null | undefined,
  query: ApprovalsSearchQuery,
) {
  const enabled = typeof userId === 'string' && userId.length > 0;
  return useQuery({
    queryKey: pendingApprovalsQueryKey(userId, query),
    queryFn: ({ signal }) => fetchPendingApprovals(query, signal),
    enabled,
    retry: false,
    staleTime: 10_000,
  });
}

export function useUsersList(
  userId: EntityId | null | undefined,
  query: UsersSearchQuery,
) {
  const enabled = typeof userId === 'string' && userId.length > 0;
  return useQuery({
    queryKey: usersListQueryKey(userId, query),
    queryFn: ({ signal }) => fetchUsersList(query, signal),
    enabled,
    retry: false,
    staleTime: 10_000,
  });
}
