import type { EntityId, UserStatus } from './index.js';

export type SystemRole = 'SUPER_ADMIN' | 'SECURITY_ADMIN' | 'DBA' | 'ANALYST' | 'DEVELOPER';

export interface RegisterRequestDTO {
  username: string;
  password: string;
  email?: string | null;
  department?: string;
  reason?: string;
}

export interface LoginRequestDTO { username: string; password: string; }

export interface ChangePasswordRequestDTO {
  oldPassword: string;
  newPassword: string;
  revokeAllPats?: boolean;
}

export interface UpdatePasswordPolicyRequestDTO { passwordExpiresDays: number | null; }

export interface ResubmitApprovalRequestDTO {
  email?: string | null;
  department?: string;
  reason: string;
}

export interface CsrfTokenDTO { csrfToken: string; }

export interface UserProfileDTO {
  id: EntityId;
  username: string;
  email: string | null;
  department: string | null;
  status: UserStatus;
  must_change_password: boolean;
  password_updated_at: string;
  password_expires_days: number | null;
  password_expires_at: string | null;
  is_password_expired: boolean;
  version: number;
  roles: SystemRole[];
  reject_reason: string | null;
  created_at: string;
}

export interface LoginResponseDTO { user: UserProfileDTO; }
export interface RegisterResponseDTO { success: true; message: string; }

export interface PasswordPolicyDTO {
  passwordExpiresDays: number | null;
  passwordExpiresAt: string | null;
  isExpirationEnabled: boolean;
  daysRemaining: number;
  isExpired: boolean;
  minDays: number;
  maxDays: number;
}

export interface UpdatePasswordPolicyResponseDTO {
  success: true;
  passwordExpiresDays: number | null;
  passwordExpiresAt: string | null;
  isExpirationEnabled: boolean;
}

export interface ActionSuccessDTO { success: true; }
export interface AuthErrorDetailsDTO { remaining_attempts?: number; retry_after_sec?: number; }

export type RestrictedUserProfileDTO = Pick<UserProfileDTO,
  'id' | 'username' | 'email' | 'department' | 'reject_reason' | 'created_at'> & { status: Exclude<UserStatus, 'ACTIVE'> };

export type CurrentUserResponseDTO = (UserProfileDTO & { status: 'ACTIVE' }) | RestrictedUserProfileDTO;
