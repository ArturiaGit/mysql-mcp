import type {
  ActionSuccessDTO,
  AuthErrorDetailsDTO,
  ChangePasswordRequestDTO,
  CsrfTokenDTO,
  CurrentUserResponseDTO,
  LoginRequestDTO,
  LoginResponseDTO,
  PasswordPolicyDTO,
  RegisterRequestDTO,
  RegisterResponseDTO,
  ResubmitApprovalRequestDTO,
  RestrictedUserProfileDTO,
  UpdatePasswordPolicyRequestDTO,
  UpdatePasswordPolicyResponseDTO,
  UserProfileDTO,
} from '@mysql-mcp/shared-types';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ActionSuccessParsed,
  AuthErrorDetailsParsed,
  ChangePasswordRequestParsed,
  CsrfTokenParsed,
  CurrentUserResponseParsed,
  LoginRequestParsed,
  LoginResponseParsed,
  PasswordPolicyParsed,
  RegisterRequestParsed,
  RegisterResponseParsed,
  ResubmitApprovalRequestParsed,
  RestrictedUserProfileParsed,
  UpdatePasswordPolicyRequestParsed,
  UpdatePasswordPolicyResponseParsed,
  UserProfileParsed,
} from '../auth.schema';

describe('auth.schema bidirectional static type equivalence with @mysql-mcp/shared-types', () => {
  it('matches all auth request DTOs bidirectionally', () => {
    expectTypeOf<LoginRequestParsed>().toEqualTypeOf<LoginRequestDTO>();
    expectTypeOf<LoginRequestDTO>().toEqualTypeOf<LoginRequestParsed>();

    expectTypeOf<RegisterRequestParsed>().toEqualTypeOf<RegisterRequestDTO>();
    expectTypeOf<RegisterRequestDTO>().toEqualTypeOf<RegisterRequestParsed>();

    expectTypeOf<ChangePasswordRequestParsed>().toEqualTypeOf<ChangePasswordRequestDTO>();
    expectTypeOf<ChangePasswordRequestDTO>().toEqualTypeOf<ChangePasswordRequestParsed>();

    expectTypeOf<UpdatePasswordPolicyRequestParsed>().toEqualTypeOf<UpdatePasswordPolicyRequestDTO>();
    expectTypeOf<UpdatePasswordPolicyRequestDTO>().toEqualTypeOf<UpdatePasswordPolicyRequestParsed>();

    expectTypeOf<ResubmitApprovalRequestParsed>().toEqualTypeOf<ResubmitApprovalRequestDTO>();
    expectTypeOf<ResubmitApprovalRequestDTO>().toEqualTypeOf<ResubmitApprovalRequestParsed>();
  });

  it('matches all auth response & user profile DTOs bidirectionally', () => {
    expectTypeOf<CsrfTokenParsed>().toEqualTypeOf<CsrfTokenDTO>();
    expectTypeOf<CsrfTokenDTO>().toEqualTypeOf<CsrfTokenParsed>();

    expectTypeOf<UserProfileParsed>().toEqualTypeOf<UserProfileDTO>();
    expectTypeOf<UserProfileDTO>().toEqualTypeOf<UserProfileParsed>();

    expectTypeOf<RestrictedUserProfileParsed>().toExtend<RestrictedUserProfileDTO>();
    expectTypeOf<RestrictedUserProfileDTO>().toExtend<RestrictedUserProfileParsed>();

    // Bidirectional equivalence for discriminated union CurrentUserResponseDTO (ACTIVE | Restricted)
    expectTypeOf<CurrentUserResponseParsed>().toExtend<CurrentUserResponseDTO>();
    expectTypeOf<CurrentUserResponseDTO>().toExtend<CurrentUserResponseParsed>();
    expectTypeOf<Extract<CurrentUserResponseParsed, { status: 'ACTIVE' }>>().toExtend<
      Extract<CurrentUserResponseDTO, { status: 'ACTIVE' }>
    >();
    expectTypeOf<Extract<CurrentUserResponseDTO, { status: 'ACTIVE' }>>().toExtend<
      Extract<CurrentUserResponseParsed, { status: 'ACTIVE' }>
    >();

    expectTypeOf<LoginResponseParsed>().toEqualTypeOf<LoginResponseDTO>();
    expectTypeOf<LoginResponseDTO>().toEqualTypeOf<LoginResponseParsed>();

    expectTypeOf<RegisterResponseParsed>().toEqualTypeOf<RegisterResponseDTO>();
    expectTypeOf<RegisterResponseDTO>().toEqualTypeOf<RegisterResponseParsed>();

    expectTypeOf<PasswordPolicyParsed>().toEqualTypeOf<PasswordPolicyDTO>();
    expectTypeOf<PasswordPolicyDTO>().toEqualTypeOf<PasswordPolicyParsed>();

    expectTypeOf<UpdatePasswordPolicyResponseParsed>().toEqualTypeOf<UpdatePasswordPolicyResponseDTO>();
    expectTypeOf<UpdatePasswordPolicyResponseDTO>().toEqualTypeOf<UpdatePasswordPolicyResponseParsed>();

    expectTypeOf<ActionSuccessParsed>().toEqualTypeOf<ActionSuccessDTO>();
    expectTypeOf<ActionSuccessDTO>().toEqualTypeOf<ActionSuccessParsed>();

    expectTypeOf<AuthErrorDetailsParsed>().toEqualTypeOf<AuthErrorDetailsDTO>();
    expectTypeOf<AuthErrorDetailsDTO>().toEqualTypeOf<AuthErrorDetailsParsed>();
  });
});
