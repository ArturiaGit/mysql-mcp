export type { ErrorCode } from './error-codes.js';
export type {
  ActionSuccessDTO,
  AuthErrorDetailsDTO,
  ChangePasswordRequestDTO,
  CsrfTokenDTO,
  CurrentUserResponseDTO,
  LoginRequestDTO,
  LoginResponseDTO,
  PatListItemDTO,
  CreatePatRequestDTO,
  CreatePatResponseDTO,
  ProfileOptionDTO,
  PasswordPolicyDTO,
  RegisterRequestDTO,
  RegisterResponseDTO,
  ResubmitApprovalRequestDTO,
  RestrictedUserProfileDTO,
  SystemRole,
  UpdatePasswordPolicyRequestDTO,
  UpdatePasswordPolicyResponseDTO,
  UserProfileDTO,
} from './auth.js';

export type EntityId = string;
export type UserStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
export type ProfileStatus = 'ACTIVE' | 'DISABLED';
export type BootstrapState = 'PENDING' | 'READY';
