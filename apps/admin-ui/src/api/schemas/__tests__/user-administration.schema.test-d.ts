import type {
  ApproveUserRequestDTO,
  ConflictErrorDetailsDTO,
  PaginatedDTO,
  PendingApprovalDTO,
  RejectUserRequestDTO,
  ResetPasswordRequestDTO,
  ResetPasswordResponseDTO,
  RoleDTO,
  UpdateUserRolesRequestDTO,
  UpdateUserStatusRequestDTO,
  UserListItemDTO,
  UserRoleSummaryDTO,
  VersionedActionSuccessDTO,
} from '@mysql-mcp/shared-types';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApproveUserRequestParsed,
  ConflictErrorDetailsParsed,
  PaginatedPendingApprovalsParsed,
  PaginatedUsersParsed,
  PendingApprovalParsed,
  RejectUserRequestParsed,
  ResetPasswordRequestParsed,
  ResetPasswordResponseParsed,
  RoleParsed,
  UpdateUserRolesRequestParsed,
  UpdateUserStatusRequestParsed,
  UserListItemParsed,
  UserRoleSummaryParsed,
  VersionedActionSuccessParsed,
} from '../user-administration.schema';

describe('user-administration.schema bidirectional static type equivalence with @mysql-mcp/shared-types', () => {
  it('matches all M3 approval, user, role and conflict DTOs bidirectionally', () => {
    expectTypeOf<PendingApprovalParsed>().toEqualTypeOf<PendingApprovalDTO>();
    expectTypeOf<PendingApprovalDTO>().toEqualTypeOf<PendingApprovalParsed>();

    expectTypeOf<PaginatedPendingApprovalsParsed>().toEqualTypeOf<PaginatedDTO<PendingApprovalDTO>>();
    expectTypeOf<PaginatedDTO<PendingApprovalDTO>>().toEqualTypeOf<PaginatedPendingApprovalsParsed>();

    expectTypeOf<ApproveUserRequestParsed>().toEqualTypeOf<ApproveUserRequestDTO>();
    expectTypeOf<ApproveUserRequestDTO>().toEqualTypeOf<ApproveUserRequestParsed>();

    expectTypeOf<RejectUserRequestParsed>().toEqualTypeOf<RejectUserRequestDTO>();
    expectTypeOf<RejectUserRequestDTO>().toEqualTypeOf<RejectUserRequestParsed>();

    expectTypeOf<UserRoleSummaryParsed>().toEqualTypeOf<UserRoleSummaryDTO>();
    expectTypeOf<UserRoleSummaryDTO>().toEqualTypeOf<UserRoleSummaryParsed>();

    expectTypeOf<UserListItemParsed>().toEqualTypeOf<UserListItemDTO>();
    expectTypeOf<UserListItemDTO>().toEqualTypeOf<UserListItemParsed>();

    expectTypeOf<PaginatedUsersParsed>().toEqualTypeOf<PaginatedDTO<UserListItemDTO>>();
    expectTypeOf<PaginatedDTO<UserListItemDTO>>().toEqualTypeOf<PaginatedUsersParsed>();

    expectTypeOf<UpdateUserStatusRequestParsed>().toEqualTypeOf<UpdateUserStatusRequestDTO>();
    expectTypeOf<UpdateUserStatusRequestDTO>().toEqualTypeOf<UpdateUserStatusRequestParsed>();

    expectTypeOf<UpdateUserRolesRequestParsed>().toEqualTypeOf<UpdateUserRolesRequestDTO>();
    expectTypeOf<UpdateUserRolesRequestDTO>().toEqualTypeOf<UpdateUserRolesRequestParsed>();

    expectTypeOf<VersionedActionSuccessParsed>().toEqualTypeOf<VersionedActionSuccessDTO>();
    expectTypeOf<VersionedActionSuccessDTO>().toEqualTypeOf<VersionedActionSuccessParsed>();

    expectTypeOf<ResetPasswordRequestParsed>().toEqualTypeOf<ResetPasswordRequestDTO>();
    expectTypeOf<ResetPasswordRequestDTO>().toEqualTypeOf<ResetPasswordRequestParsed>();

    expectTypeOf<ResetPasswordResponseParsed>().toEqualTypeOf<ResetPasswordResponseDTO>();
    expectTypeOf<ResetPasswordResponseDTO>().toEqualTypeOf<ResetPasswordResponseParsed>();

    expectTypeOf<RoleParsed>().toEqualTypeOf<RoleDTO>();
    expectTypeOf<RoleDTO>().toEqualTypeOf<RoleParsed>();

    expectTypeOf<ConflictErrorDetailsParsed>().toEqualTypeOf<ConflictErrorDetailsDTO>();
    expectTypeOf<ConflictErrorDetailsDTO>().toEqualTypeOf<ConflictErrorDetailsParsed>();
  });
});
