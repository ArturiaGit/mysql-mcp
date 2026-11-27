import type { PatListItemDTO } from '@mysql-mcp/shared-types';
import { PAT_EXPIRES_DEFAULT_DAYS } from '@/api/schemas/pat.schema';

export type PatModalPhase = 'input' | 'reveal';

export interface PatModalState {
  phase: PatModalPhase;
  name: string;
  expiresDaysInput: string;
  nameError: string;
  expiresError: string;
  submitError: string;
  submitting: boolean;
  createdPat: PatListItemDTO | null;
  rawToken: string | null;
  secretMasked: boolean;
  backupConfirmed: boolean;
  confirmReminderVisible: boolean;
}

export type PatModalAction =
  | { type: 'RESET_AND_CLEAR_SECRET' }
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_EXPIRES_DAYS'; value: string }
  | { type: 'SET_VALIDATION_ERRORS'; nameError: string; expiresError: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_ERROR'; message?: string; nameError?: string }
  | { type: 'SUBMIT_SUCCESS'; pat: PatListItemDTO; rawToken: string }
  | { type: 'TOGGLE_SECRET_MASK' }
  | { type: 'SET_BACKUP_CONFIRMED'; checked: boolean }
  | { type: 'SHOW_CONFIRM_REMINDER' };

export function createInitialPatModalState(): PatModalState {
  return {
    phase: 'input',
    name: '',
    expiresDaysInput: String(PAT_EXPIRES_DEFAULT_DAYS),
    nameError: '',
    expiresError: '',
    submitError: '',
    submitting: false,
    createdPat: null,
    rawToken: null,
    secretMasked: false,
    backupConfirmed: false,
    confirmReminderVisible: false,
  };
}

/**
 * Determines whether closing the modal is permitted:
 * - While submitting: blocked (prevent in-flight abandonment / orphaned token).
 * - In reveal phase with an active rawToken: strictly requires `backupConfirmed === true`
 *   (no skip-confirmation force-close path).
 * - Otherwise: safe to close (caller must immediately dispatch RESET_AND_CLEAR_SECRET).
 */
export function canClosePatModalSafely(state: PatModalState): boolean {
  if (state.submitting) {
    return false;
  }
  if (state.phase === 'reveal' && state.rawToken !== null && !state.backupConfirmed) {
    return false;
  }
  return true;
}

export function patModalReducer(state: PatModalState, action: PatModalAction): PatModalState {
  switch (action.type) {
    case 'RESET_AND_CLEAR_SECRET':
      return createInitialPatModalState();

    case 'SET_NAME':
      return {
        ...state,
        name: action.value,
        nameError: state.nameError ? '' : state.nameError,
        submitError: state.submitError ? '' : state.submitError,
      };

    case 'SET_EXPIRES_DAYS':
      return {
        ...state,
        expiresDaysInput: action.value,
        expiresError: state.expiresError ? '' : state.expiresError,
        submitError: state.submitError ? '' : state.submitError,
      };

    case 'SET_VALIDATION_ERRORS':
      return {
        ...state,
        nameError: action.nameError,
        expiresError: action.expiresError,
      };

    case 'SUBMIT_START':
      if (state.submitting || state.phase === 'reveal') {
        return state;
      }
      return {
        ...state,
        submitting: true,
        nameError: '',
        expiresError: '',
        submitError: '',
      };

    case 'SUBMIT_ERROR':
      return {
        ...state,
        submitting: false,
        nameError: action.nameError ?? '',
        submitError: action.message ?? '',
      };

    case 'SUBMIT_SUCCESS':
      return {
        ...state,
        phase: 'reveal',
        submitting: false,
        nameError: '',
        expiresError: '',
        submitError: '',
        createdPat: action.pat,
        rawToken: action.rawToken,
        secretMasked: false,
        backupConfirmed: false,
        confirmReminderVisible: false,
      };

    case 'TOGGLE_SECRET_MASK':
      return {
        ...state,
        secretMasked: !state.secretMasked,
      };

    case 'SET_BACKUP_CONFIRMED':
      return {
        ...state,
        backupConfirmed: action.checked,
        confirmReminderVisible: action.checked ? false : state.confirmReminderVisible,
      };

    case 'SHOW_CONFIRM_REMINDER':
      if (state.phase !== 'reveal' || state.rawToken === null || state.backupConfirmed) {
        return state;
      }
      return {
        ...state,
        confirmReminderVisible: true,
      };
  }
}

export function maskPatToken(rawToken: string): string {
  const prefix = rawToken.slice(0, 16);
  const suffix = rawToken.slice(-4);
  return `${prefix}${'•'.repeat(Math.max(8, rawToken.length - 20))}${suffix}`;
}
