import type {
  ActionSuccessDTO,
  ChangePasswordRequestDTO,
  CurrentUserResponseDTO,
  LoginRequestDTO,
  LoginResponseDTO,
  PasswordPolicyDTO,
  RegisterRequestDTO,
  RegisterResponseDTO,
  ResubmitApprovalRequestDTO,
  UpdatePasswordPolicyRequestDTO,
  UpdatePasswordPolicyResponseDTO,
  UserProfileDTO,
} from '@mysql-mcp/shared-types';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, clearActiveCsrfToken, refreshCsrfToken } from './client';
import {
  ActionSuccessSchema,
  CurrentUserResponseSchema,
  LoginResponseSchema,
  PasswordPolicySchema,
  RegisterResponseSchema,
  UpdatePasswordPolicyResponseSchema,
} from './schemas/auth.schema';

export const AUTH_ME_QUERY_KEY = ['auth', 'me'] as const;
export const PASSWORD_POLICY_QUERY_KEY = ['auth', 'password-policy'] as const;

export function toCurrentUserResponse(user: UserProfileDTO): CurrentUserResponseDTO {
  if (user.status === 'ACTIVE') {
    return { ...user, status: 'ACTIVE' };
  }
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    department: user.department,
    status: user.status,
    reject_reason: user.reject_reason,
    created_at: user.created_at,
  };
}

export async function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUserResponseDTO> {
  return apiRequest<CurrentUserResponseDTO>('/api/v1/auth/me', {
    method: 'GET',
    schema: CurrentUserResponseSchema,
    signal,
    skipUnauthorizedRedirect: true,
  });
}

export async function loginWithPassword(payload: LoginRequestDTO): Promise<LoginResponseDTO> {
  const result = await apiRequest<LoginResponseDTO>('/api/v1/auth/login', {
    method: 'POST',
    body: payload,
    schema: LoginResponseSchema,
    skipUnauthorizedRedirect: true,
  });
  // Session & CSRF seed rotate on login; refresh CSRF token proactively.
  clearActiveCsrfToken();
  await refreshCsrfToken();
  return result;
}

export async function registerAccount(payload: RegisterRequestDTO): Promise<RegisterResponseDTO> {
  return apiRequest<RegisterResponseDTO>('/api/v1/auth/register', {
    method: 'POST',
    body: payload,
    schema: RegisterResponseSchema,
    skipUnauthorizedRedirect: true,
  });
}

export async function changePassword(payload: ChangePasswordRequestDTO): Promise<ActionSuccessDTO> {
  const result = await apiRequest<ActionSuccessDTO>('/api/v1/auth/change-password', {
    method: 'POST',
    body: payload,
    schema: ActionSuccessSchema,
  });
  // Session & CSRF seed rotate on password change; refresh CSRF token proactively.
  clearActiveCsrfToken();
  await refreshCsrfToken();
  return result;
}

export async function fetchPasswordPolicy(signal?: AbortSignal): Promise<PasswordPolicyDTO> {
  return apiRequest<PasswordPolicyDTO>('/api/v1/auth/password-policy', {
    method: 'GET',
    schema: PasswordPolicySchema,
    signal,
  });
}

export async function updatePasswordPolicy(
  payload: UpdatePasswordPolicyRequestDTO,
): Promise<UpdatePasswordPolicyResponseDTO> {
  return apiRequest<UpdatePasswordPolicyResponseDTO>('/api/v1/auth/password-policy', {
    method: 'PUT',
    body: payload,
    schema: UpdatePasswordPolicyResponseSchema,
  });
}

export async function resubmitApproval(
  payload: ResubmitApprovalRequestDTO,
): Promise<ActionSuccessDTO> {
  return apiRequest<ActionSuccessDTO>('/api/v1/approvals/resubmit', {
    method: 'POST',
    body: payload,
    schema: ActionSuccessSchema,
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    retry: false,
    staleTime: 30_000,
  });
}

export function usePasswordPolicy(enabled = true) {
  return useQuery({
    queryKey: PASSWORD_POLICY_QUERY_KEY,
    queryFn: ({ signal }) => fetchPasswordPolicy(signal),
    enabled,
    retry: false,
    staleTime: 15_000,
  });
}
