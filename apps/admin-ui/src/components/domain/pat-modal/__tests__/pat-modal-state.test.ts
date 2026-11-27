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

describe('pat-modal strict checkbox-gated safeguard reducer', () => {
  it('starts in input phase with default 90 days and no secret in memory', () => {
    const state = createInitialPatModalState();
    expect(state.phase).toBe('input');
    expect(state.expiresDaysInput).toBe('90');
    expect(state.rawToken).toBeNull();
    expect(state.createdPat).toBeNull();
    expect(state.confirmReminderVisible).toBe(false);
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

    // Error returns cleanly to editable input phase preserving form draft
    state = patModalReducer(state, { type: 'SUBMIT_ERROR', message: '密码已过期' });
    expect(state.submitting).toBe(false);
    expect(state.submitError).toBe('密码已过期');
    expect(state.name).toBe('Cursor-Agent-Dev');
    expect(canClosePatModalSafely(state)).toBe(true);
  });

  it('surfaces inline 409 ERR_PAT_NAME_EXISTS error, preserves draft, and clears on name edit', () => {
    let state = createInitialPatModalState();
    state = patModalReducer(state, { type: 'SET_NAME', value: 'Cursor-Agent-Dev' });
    state = patModalReducer(state, { type: 'SET_EXPIRES_DAYS', value: '45' });
    state = patModalReducer(state, { type: 'SUBMIT_START' });
    state = patModalReducer(state, {
      type: 'SUBMIT_ERROR',
      nameError: '该令牌名称已被占用，请更换其他名称。同一账号下有效令牌名称不可重复；吊销旧令牌后方可复用同名。',
    });

    expect(state.phase).toBe('input');
    expect(state.submitting).toBe(false);
    expect(state.name).toBe('Cursor-Agent-Dev');
    expect(state.expiresDaysInput).toBe('45');
    expect(state.nameError).toContain('该令牌名称已被占用');
    expect(state.submitError).toBe('');

    // Editing the name clears the duplicate-name error automatically
    state = patModalReducer(state, { type: 'SET_NAME', value: 'Cursor-Agent-Dev-2' });
    expect(state.nameError).toBe('');
  });

  it('strictly blocks close in reveal phase until backup checkbox is checked and shows text-only reminder', () => {
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
    expect(state.confirmReminderVisible).toBe(false);
    expect(canClosePatModalSafely(state)).toBe(false);

    // Unconfirmed Esc / X / backdrop shows text-only reminder and keeps close blocked
    state = patModalReducer(state, { type: 'SHOW_CONFIRM_REMINDER' });
    expect(state.confirmReminderVisible).toBe(true);
    expect(state.rawToken).toBe(SAMPLE_RAW_TOKEN);
    expect(canClosePatModalSafely(state)).toBe(false);

    // Checking backup confirmation hides reminder and unlocks safe close
    state = patModalReducer(state, { type: 'SET_BACKUP_CONFIRMED', checked: true });
    expect(state.backupConfirmed).toBe(true);
    expect(state.confirmReminderVisible).toBe(false);
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
    expect(state.confirmReminderVisible).toBe(false);
  });

  it('masks PAT token while preserving prefix and last 4 characters', () => {
    const masked = maskPatToken(SAMPLE_RAW_TOKEN);
    expect(masked.startsWith(SAMPLE_RAW_TOKEN.slice(0, 16))).toBe(true);
    expect(masked.endsWith(SAMPLE_RAW_TOKEN.slice(-4))).toBe(true);
    expect(masked).not.toBe(SAMPLE_RAW_TOKEN);
    expect(masked).toContain('•');
  });
});
