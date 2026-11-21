import type { PatListItemDTO } from '@mysql-mcp/shared-types';
import { describe, expect, it } from 'vitest';
import {
  canClosePatModalSafely,
  createInitialPatModalState,
  maskPatToken,
  patModalReducer,
} from '../pat-modal-state';

const SAMPLE_PAT: PatListItemDTO = {
  id: '9007199254740993123',
  name: 'Cursor-Agent-Dev',
  token_prefix: 'mcp_pat_8f3a9e2d',
  expires_at: '2027-02-06T06:00:00.000Z',
  last_used_at: null,
  created_at: '2026-11-08T06:00:00.000Z',
};

const SAMPLE_RAW_TOKEN = `mcp_pat_${'8f3a9e2d'.repeat(8)}`;

describe('pat-modal 3-state safeguard reducer', () => {
  it('starts in input phase with default 90 days and no secret in memory', () => {
    const state = createInitialPatModalState();
    expect(state.phase).toBe('input');
    expect(state.expiresDaysInput).toBe('90');
    expect(state.rawToken).toBeNull();
    expect(state.createdPat).toBeNull();
    expect(canClosePatModalSafely(state)).toBe(true);
  });

  it('prevents closing and duplicate submits while request is in flight', () => {
    let state = createInitialPatModalState();
    state = patModalReducer(state, { type: 'SET_NAME', value: 'Cursor-Agent-Dev' });
    state = patModalReducer(state, { type: 'SUBMIT_START' });

    expect(state.submitting).toBe(true);
    expect(canClosePatModalSafely(state)).toBe(false);

    // Re-entrant SUBMIT_START must be a no-op
    const next = patModalReducer(state, { type: 'SUBMIT_START' });
    expect(next).toBe(state);

    // Error returns cleanly to editable input phase
    state = patModalReducer(state, { type: 'SUBMIT_ERROR', message: '密码已过期' });
    expect(state.submitting).toBe(false);
    expect(state.submitError).toBe('密码已过期');
    expect(state.name).toBe('Cursor-Agent-Dev');
    expect(canClosePatModalSafely(state)).toBe(true);
  });

  it('blocks close in reveal phase until backup checkbox is confirmed and expands discard prompt', () => {
    let state = createInitialPatModalState();
    state = patModalReducer(state, { type: 'SUBMIT_START' });
    state = patModalReducer(state, {
      type: 'SUBMIT_SUCCESS',
      pat: SAMPLE_PAT,
      rawToken: SAMPLE_RAW_TOKEN,
    });

    expect(state.phase).toBe('reveal');
    expect(state.rawToken).toBe(SAMPLE_RAW_TOKEN);
    expect(state.backupConfirmed).toBe(false);
    expect(state.discardPromptVisible).toBe(false);
    expect(canClosePatModalSafely(state)).toBe(false);

    // Unconfirmed Esc / close / backdrop triggers in-place retention prompt
    state = patModalReducer(state, { type: 'SHOW_DISCARD_PROMPT' });
    expect(state.discardPromptVisible).toBe(true);
    expect(state.rawToken).toBe(SAMPLE_RAW_TOKEN);

    // Choosing "keep saving" hides prompt without losing token
    state = patModalReducer(state, { type: 'HIDE_DISCARD_PROMPT' });
    expect(state.discardPromptVisible).toBe(false);
    expect(state.rawToken).toBe(SAMPLE_RAW_TOKEN);

    // Checking backup confirmation unlocks safe close & auto-hides discard prompt
    state = patModalReducer(state, { type: 'SHOW_DISCARD_PROMPT' });
    state = patModalReducer(state, { type: 'SET_BACKUP_CONFIRMED', checked: true });
    expect(state.backupConfirmed).toBe(true);
    expect(state.discardPromptVisible).toBe(false);
    expect(canClosePatModalSafely(state)).toBe(true);
  });

  it('zeroes out rawToken and createdPat completely on RESET_AND_CLEAR_SECRET', () => {
    let state = createInitialPatModalState();
    state = patModalReducer(state, {
      type: 'SUBMIT_SUCCESS',
      pat: SAMPLE_PAT,
      rawToken: SAMPLE_RAW_TOKEN,
    });
    expect(state.rawToken).toBe(SAMPLE_RAW_TOKEN);

    state = patModalReducer(state, { type: 'RESET_AND_CLEAR_SECRET' });
    expect(state.phase).toBe('input');
    expect(state.rawToken).toBeNull();
    expect(state.createdPat).toBeNull();
    expect(state.backupConfirmed).toBe(false);
    expect(state.discardPromptVisible).toBe(false);
  });

  it('masks PAT token while preserving prefix and last 4 characters', () => {
    const masked = maskPatToken(SAMPLE_RAW_TOKEN);
    expect(masked.startsWith(SAMPLE_RAW_TOKEN.slice(0, 16))).toBe(true);
    expect(masked.endsWith(SAMPLE_RAW_TOKEN.slice(-4))).toBe(true);
    expect(masked).not.toBe(SAMPLE_RAW_TOKEN);
    expect(masked).toContain('•');
  });
});
