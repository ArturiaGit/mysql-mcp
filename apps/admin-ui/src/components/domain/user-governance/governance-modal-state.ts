import type { ConflictErrorDetailsDTO, EntityId } from '@mysql-mcp/shared-types';
import type { ResetPasswordMode } from '@/api/schemas/user-administration.schema';

export interface ResetPasswordModalState {
  phase: 'form' | 'reveal';
  mode: ResetPasswordMode;
  manualPassword: string;
  showManualPassword: boolean;
  mustChangePassword: boolean;
  workingVersion: number;
  conflict: ConflictErrorDetailsDTO | null;
  revealedPassword: string | null;
  showRevealedPassword: boolean;
  copied: boolean;
}

export function createInitialResetPasswordState(version: number): ResetPasswordModalState {
  return {
    phase: 'form',
    mode: 'auto',
    manualPassword: '',
    showManualPassword: false,
    mustChangePassword: true,
    workingVersion: version,
    conflict: null,
    revealedPassword: null,
    showRevealedPassword: true,
    copied: false,
  };
}

/**
 * 409 ERR_CONCURRENCY_CONFLICT: NEVER wipe password draft or mustChangePassword flag!
 */
export function recordResetPasswordConflict(
  state: ResetPasswordModalState,
  details: ConflictErrorDetailsDTO | undefined,
): ResetPasswordModalState {
  return {
    ...state,
    conflict: details ?? {
      current_version: state.workingVersion + 1,
      submitted_version: state.workingVersion,
    },
  };
}

/**
 * Load latest remote version while preserving the administrator's unsaved password draft & checkbox.
 */
export function applyLatestVersionPreservingResetDraft(
  state: ResetPasswordModalState,
  latestVersion: number,
): ResetPasswordModalState {
  return {
    ...state,
    workingVersion: latestVersion,
    conflict: null,
  };
}

/**
 * Transition to one-time reveal phase; immediately clear manual input draft so only ephemeral
 * revealedPassword lives in local component memory until close/unmount.
 */
export function enterResetPasswordReveal(
  state: ResetPasswordModalState,
  temporaryPassword: string,
  nextVersion: number,
): ResetPasswordModalState {
  return {
    ...state,
    phase: 'reveal',
    manualPassword: '',
    showManualPassword: false,
    workingVersion: nextVersion,
    conflict: null,
    revealedPassword: temporaryPassword,
    showRevealedPassword: true,
    copied: false,
  };
}

/**
 * Wipe ALL in-memory secret strings immediately upon modal close or component unmount.
 */
export function wipeResetPasswordSecrets(version: number): ResetPasswordModalState {
  return createInitialResetPasswordState(version);
}

export interface EditRolesModalState {
  selectedRoleIds: EntityId[];
  remoteRoleIds: EntityId[];
  workingVersion: number;
  conflict: ConflictErrorDetailsDTO | null;
}

export function createInitialEditRolesState(
  roleIds: readonly EntityId[],
  version: number,
): EditRolesModalState {
  return {
    selectedRoleIds: [...roleIds],
    remoteRoleIds: [...roleIds],
    workingVersion: version,
    conflict: null,
  };
}

/**
 * 409 ERR_CONCURRENCY_CONFLICT: preserve the user's edited selectedRoleIds draft untouched.
 */
export function recordEditRolesConflict(
  state: EditRolesModalState,
  details: ConflictErrorDetailsDTO | undefined,
): EditRolesModalState {
  return {
    ...state,
    conflict: details ?? {
      current_version: state.workingVersion + 1,
      submitted_version: state.workingVersion,
    },
  };
}

/**
 * Refresh latest version & remote roles snapshot for side-by-side comparison while keeping draft intact.
 */
export function loadLatestVersionPreservingRoleDraft(
  state: EditRolesModalState,
  latestRoleIds: readonly EntityId[],
  latestVersion: number,
): EditRolesModalState {
  return {
    ...state,
    remoteRoleIds: [...latestRoleIds],
    workingVersion: latestVersion,
    conflict: null,
  };
}

/**
 * Discard local role draft and reset selection to the latest remote roles.
 */
export function discardRoleDraftAndReload(
  latestRoleIds: readonly EntityId[],
  latestVersion: number,
): EditRolesModalState {
  return createInitialEditRolesState(latestRoleIds, latestVersion);
}
