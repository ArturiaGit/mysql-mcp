import { describe, expect, it } from 'vitest';
import {
  applyLatestVersionPreservingResetDraft,
  createInitialEditRolesState,
  createInitialResetPasswordState,
  discardRoleDraftAndReload,
  enterResetPasswordReveal,
  loadLatestVersionPreservingRoleDraft,
  recordEditRolesConflict,
  recordResetPasswordConflict,
  wipeResetPasswordSecrets,
} from '../governance-modal-state';

describe('ResetPasswordModal state machine (409 draft preservation & zero-leak wipe)', () => {
  it('preserves manual password and mustChangePassword draft on 409 conflict and version reload', () => {
    let state = createInitialResetPasswordState(2);
    state = {
      ...state,
      mode: 'manual',
      manualPassword: 'DraftTemp#2026!9',
      mustChangePassword: false,
    };

    state = recordResetPasswordConflict(state, { current_version: 5, submitted_version: 2 });
    expect(state.conflict).toEqual({ current_version: 5, submitted_version: 2 });
    expect(state.mode).toBe('manual');
    expect(state.manualPassword).toBe('DraftTemp#2026!9');
    expect(state.mustChangePassword).toBe(false);

    state = applyLatestVersionPreservingResetDraft(state, 5);
    expect(state.workingVersion).toBe(5);
    expect(state.conflict).toBeNull();
    expect(state.manualPassword).toBe('DraftTemp#2026!9');
    expect(state.mustChangePassword).toBe(false);
  });

  it('reveals temporaryPassword once and wipes all secret fields immediately on close', () => {
    let state = createInitialResetPasswordState(5);
    state = {
      ...state,
      mode: 'manual',
      manualPassword: 'DraftTemp#2026!9',
    };

    state = enterResetPasswordReveal(state, 'TempSecret#9988!', 6);
    expect(state.phase).toBe('reveal');
    expect(state.revealedPassword).toBe('TempSecret#9988!');
    expect(state.manualPassword).toBe('');
    expect(state.workingVersion).toBe(6);

    const wiped = wipeResetPasswordSecrets(6);
    expect(wiped.phase).toBe('form');
    expect(wiped.revealedPassword).toBeNull();
    expect(wiped.manualPassword).toBe('');
    expect(wiped.mustChangePassword).toBe(true);
    expect(wiped.copied).toBe(false);
  });
});

describe('EditUserRolesModal state machine (409 draft preservation & discard)', () => {
  it('preserves edited role selection draft across 409 conflict and version reload', () => {
    let state = createInitialEditRolesState(['3'], 1);
    state = { ...state, selectedRoleIds: ['3', '4'] };

    state = recordEditRolesConflict(state, { current_version: 3, submitted_version: 1 });
    expect(state.conflict).toEqual({ current_version: 3, submitted_version: 1 });
    expect(state.selectedRoleIds).toEqual(['3', '4']);

    state = loadLatestVersionPreservingRoleDraft(state, ['2'], 3);
    expect(state.workingVersion).toBe(3);
    expect(state.conflict).toBeNull();
    expect(state.remoteRoleIds).toEqual(['2']);
    expect(state.selectedRoleIds).toEqual(['3', '4']);

    const discarded = discardRoleDraftAndReload(['2'], 3);
    expect(discarded.selectedRoleIds).toEqual(['2']);
    expect(discarded.remoteRoleIds).toEqual(['2']);
    expect(discarded.workingVersion).toBe(3);
  });
});
