import type { CurrentUserResponseDTO, PatListItemDTO, ProfileOptionDTO } from '@mysql-mcp/shared-types';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_ME_QUERY_KEY, PASSWORD_POLICY_QUERY_KEY } from '../auth';
import { getActiveCsrfToken, setActiveCsrfToken } from '../client';
import { myProfileOptionsQueryKey, patsQueryKey } from '../pats';
import {
  resetSessionCacheForLogin,
  resetSessionCacheOnUnauthorized,
} from '../session-cache';
import { SessionRequestManager } from '../session-request';

const USER_A: CurrentUserResponseDTO = {
  id: '1001',
  username: 'alice_dev',
  email: 'alice@example.test',
  department: 'Data',
  status: 'ACTIVE',
  must_change_password: false,
  password_updated_at: '2026-11-01T00:00:00.000Z',
  password_expires_days: 90,
  password_expires_at: '2027-01-30T00:00:00.000Z',
  is_password_expired: false,
  version: 1,
  roles: ['DEVELOPER'],
  reject_reason: null,
  created_at: '2026-11-01T00:00:00.000Z',
};

const USER_B: CurrentUserResponseDTO = {
  id: '2002',
  username: 'bob_analyst',
  email: 'bob@example.test',
  department: 'Analytics',
  status: 'ACTIVE',
  must_change_password: false,
  password_updated_at: '2026-11-01T00:00:00.000Z',
  password_expires_days: 90,
  password_expires_at: '2027-01-30T00:00:00.000Z',
  is_password_expired: false,
  version: 1,
  roles: ['ANALYST'],
  reject_reason: null,
  created_at: '2026-11-01T00:00:00.000Z',
};

const USER_A_PATS: PatListItemDTO[] = [
  {
    id: '501',
    name: 'Alice-Prod-PAT',
    token_prefix: 'mcp_pat_11223344',
    expires_at: '2027-02-01T00:00:00.000Z',
    last_used_at: null,
    created_at: '2026-11-01T00:00:00.000Z',
  },
];

const USER_A_PROFILES: ProfileOptionDTO[] = [
  {
    id: '901',
    name: 'prod_analytics',
    displayName: '分析只读主库',
  },
];

describe('cross-user React Query cache isolation', () => {
  afterEach(() => {
    setActiveCsrfToken(null);
    vi.restoreAllMocks();
  });

  it('namespaces PAT and Profile option query keys strictly by userId', () => {
    expect(patsQueryKey(USER_A.id)).toEqual(['developer', '1001', 'pats']);
    expect(patsQueryKey(USER_B.id)).toEqual(['developer', '2002', 'pats']);
    expect(patsQueryKey(null)).toEqual(['developer', 'anonymous', 'pats']);
    expect(patsQueryKey(USER_A.id)).not.toEqual(patsQueryKey(USER_B.id));

    expect(myProfileOptionsQueryKey(USER_A.id)).toEqual(['developer', '1001', 'profile-options']);
    expect(myProfileOptionsQueryKey(USER_B.id)).toEqual(['developer', '2002', 'profile-options']);
    expect(myProfileOptionsQueryKey(USER_A.id)).not.toEqual(myProfileOptionsQueryKey(USER_B.id));
  });

  it('clears all cached auth/developer queries, aborts in-flight signal, and clears CSRF on 401', () => {
    const qc = new QueryClient();
    const requestManager = new SessionRequestManager();
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');

    qc.setQueryData(AUTH_ME_QUERY_KEY, USER_A);
    qc.setQueryData(PASSWORD_POLICY_QUERY_KEY, { isExpirationEnabled: true });
    qc.setQueryData(patsQueryKey(USER_A.id), USER_A_PATS);
    qc.setQueryData(myProfileOptionsQueryKey(USER_A.id), USER_A_PROFILES);
    setActiveCsrfToken('csrf-user-a');

    const oldSignal = requestManager.getSignal();
    expect(oldSignal.aborted).toBe(false);

    resetSessionCacheOnUnauthorized(qc, requestManager);

    expect(oldSignal.aborted).toBe(true);
    expect(requestManager.getSignal().aborted).toBe(false);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(getActiveCsrfToken()).toBeNull();
    expect(qc.getQueryData(AUTH_ME_QUERY_KEY)).toBeUndefined();
    expect(qc.getQueryData(PASSWORD_POLICY_QUERY_KEY)).toBeUndefined();
    expect(qc.getQueryData(patsQueryKey(USER_A.id))).toBeUndefined();
    expect(qc.getQueryData(myProfileOptionsQueryKey(USER_A.id))).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('wipes prior user caches and aborts prior requests on direct /login account switch', () => {
    const qc = new QueryClient();
    const requestManager = new SessionRequestManager();
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');

    // User A populated developer caches and did NOT click logout before User B logs in
    qc.setQueryData(AUTH_ME_QUERY_KEY, USER_A);
    qc.setQueryData(patsQueryKey(USER_A.id), USER_A_PATS);
    qc.setQueryData(myProfileOptionsQueryKey(USER_A.id), USER_A_PROFILES);
    // Fresh CSRF token rotated by loginWithPassword for User B
    setActiveCsrfToken('csrf-user-b-fresh');

    const oldSignal = requestManager.getSignal();

    resetSessionCacheForLogin(qc, USER_B, requestManager);

    expect(oldSignal.aborted).toBe(true);
    expect(requestManager.getSignal().aborted).toBe(false);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    // Post-login CSRF token must remain intact for User B's subsequent mutations
    expect(getActiveCsrfToken()).toBe('csrf-user-b-fresh');
    // User A's cached metadata must be completely gone
    expect(qc.getQueryData(patsQueryKey(USER_A.id))).toBeUndefined();
    expect(qc.getQueryData(myProfileOptionsQueryKey(USER_A.id))).toBeUndefined();
    // User B has no stale developer cache and holds ONLY fresh ['auth', 'me']
    expect(qc.getQueryData(patsQueryKey(USER_B.id))).toBeUndefined();
    expect(qc.getQueryData(myProfileOptionsQueryKey(USER_B.id))).toBeUndefined();
    expect(qc.getQueryData(AUTH_ME_QUERY_KEY)).toEqual(USER_B);
    expect(qc.getQueryCache().getAll()).toHaveLength(1);
  });
});
