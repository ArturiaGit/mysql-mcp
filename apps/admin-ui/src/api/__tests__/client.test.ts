import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiRequest,
  clearActiveCsrfToken,
  getActiveCsrfToken,
  handleLogout,
  isApiClientError,
  refreshCsrfToken,
  registerUnauthorizedHandler,
  sanitizeReturnUrl,
  setActiveCsrfToken,
} from '../client';
import { SessionRequestManager } from '../session-request';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearActiveCsrfToken();
  registerUnauthorizedHandler(null);
});

describe('sanitizeReturnUrl boundary security tests', () => {
  const origin = 'https://console.example';

  it('rejects backslash smuggling', () => {
    expect(sanitizeReturnUrl(String.raw`/\example.org/account`, '/dashboard', origin)).toBe(
      '/dashboard',
    );
  });

  it('rejects path traversal producing protocol-relative // escape', () => {
    expect(sanitizeReturnUrl('/a/..//example.org/account', '/dashboard', origin)).toBe(
      '/dashboard',
    );
  });

  it('rejects same-origin URLs whose pathname starts with //', () => {
    expect(
      sanitizeReturnUrl('https://console.example//example.org/account', '/dashboard', origin),
    ).toBe('/dashboard');
  });

  it('rejects cross-origin, protocol-relative, javascript:, and control chars', () => {
    expect(sanitizeReturnUrl('//evil.example/steal', '/dashboard', origin)).toBe('/dashboard');
    expect(sanitizeReturnUrl('https://evil.example/dashboard', '/dashboard', origin)).toBe(
      '/dashboard',
    );
    expect(sanitizeReturnUrl('javascript:alert(1)', '/dashboard', origin)).toBe('/dashboard');
    expect(sanitizeReturnUrl('/dashboard\r\nSet-Cookie:x=1', '/dashboard', origin)).toBe(
      '/dashboard',
    );
  });

  it('preserves valid same-origin paths with query parameters and hash', () => {
    expect(sanitizeReturnUrl('/audits?status=SUCCESS', '/dashboard', origin)).toBe(
      '/audits?status=SUCCESS',
    );
    expect(
      sanitizeReturnUrl('https://console.example/profiles?page=2#details', '/dashboard', origin),
    ).toBe('/profiles?page=2#details');
  });
});

describe('single-flight CSRF refresh & retry boundaries', () => {
  it('deduplicates concurrent CSRF refresh calls into a single GET /api/v1/auth/csrf', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse({ csrfToken: 'tok_singleflight_1' });
    });

    const [a, b, c] = await Promise.all([
      refreshCsrfToken(mockFetch),
      refreshCsrfToken(mockFetch),
      refreshCsrfToken(mockFetch),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe('tok_singleflight_1');
    expect(b).toBe('tok_singleflight_1');
    expect(c).toBe('tok_singleflight_1');
    expect(getActiveCsrfToken()).toBe('tok_singleflight_1');
  });

  it('retries mutating request ONCE on 403 ERR_CSRF_INVALID and never retries ordinary 403', async () => {
    setActiveCsrfToken('stale_token');
    let postAttempts = 0;
    let csrfCalls = 0;

    const retryFetch: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        csrfCalls += 1;
        return jsonResponse({ csrfToken: 'fresh_token' });
      }
      postAttempts += 1;
      const headers = new Headers(init?.headers);
      if (headers.get('x-csrf-token') === 'stale_token') {
        return jsonResponse(
          { code: 'ERR_CSRF_INVALID', message: 'CSRF invalid', action_guidance: 'retry' },
          403,
        );
      }
      return jsonResponse({ success: true }, 200);
    });

    const res = await apiRequest<{ success: true }>('/api/v1/approvals/resubmit', {
      method: 'POST',
      body: { reason: '补充审批号' },
      fetchImpl: retryFetch,
    });
    expect(res.success).toBe(true);
    expect(csrfCalls).toBe(1);
    expect(postAttempts).toBe(2);

    // Ordinary RBAC 403 must NEVER trigger CSRF refresh or retry
    let forbiddenAttempts = 0;
    let forbiddenCsrfCalls = 0;
    const forbiddenFetch: typeof fetch = vi.fn(async (input) => {
      if (String(input) === '/api/v1/auth/csrf') {
        forbiddenCsrfCalls += 1;
        return jsonResponse({ csrfToken: 'unused' });
      }
      forbiddenAttempts += 1;
      return jsonResponse(
        { code: 'ERR_RBAC_FORBIDDEN', message: 'Forbidden', action_guidance: 'No access' },
        403,
      );
    });

    await expect(
      apiRequest('/api/v1/users', { method: 'POST', body: {}, fetchImpl: forbiddenFetch }),
    ).rejects.toSatisfy((err: unknown) => isApiClientError(err) && err.code === 'ERR_RBAC_FORBIDDEN');
    expect(forbiddenAttempts).toBe(1);
    expect(forbiddenCsrfCalls).toBe(0);
  });

  it('does NOT kick out session on 400 ERR_OLD_PASSWORD_INVALID but invokes unauthorized handler on 401', async () => {
    setActiveCsrfToken('valid_csrf');
    const unauthorizedSpy = vi.fn();
    registerUnauthorizedHandler(unauthorizedSpy);

    const wrongOldFetch: typeof fetch = vi.fn(async () =>
      jsonResponse(
        {
          code: 'ERR_OLD_PASSWORD_INVALID',
          message: '当前密码不正确。',
          action_guidance: '请核对当前密码后重试。',
        },
        400,
      ),
    );

    await expect(
      apiRequest('/api/v1/auth/change-password', {
        method: 'POST',
        body: { oldPassword: 'wrong', newPassword: 'StrongPassword1!' },
        fetchImpl: wrongOldFetch,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isApiClientError(err) && err.status === 400 && err.code === 'ERR_OLD_PASSWORD_INVALID',
    );
    expect(unauthorizedSpy).not.toHaveBeenCalled();

    const unauthFetch: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { code: 'ERR_AUTH_UNAUTHORIZED', message: '登录会话无效。', action_guidance: '请重新登录。' },
        401,
      ),
    );
    await expect(apiRequest('/api/v1/auth/password-policy', { fetchImpl: unauthFetch })).rejects.toThrow();
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
  });

  it('parses 409 ERR_CONCURRENCY_CONFLICT details with current_version and submitted_version', async () => {
    setActiveCsrfToken('valid_csrf');
    const conflictFetch: typeof fetch = vi.fn(async () =>
      jsonResponse(
        {
          code: 'ERR_CONCURRENCY_CONFLICT',
          message: '当前配置已被其他管理员更新。',
          action_guidance: '请保留修改草稿，加载最新版本并比对后重新提交。',
          details: { current_version: 5, submitted_version: 3 },
        },
        409,
      ),
    );

    await expect(
      apiRequest('/api/v1/users/1002/roles', {
        method: 'PUT',
        body: { roleIds: ['2'], version: 3 },
        fetchImpl: conflictFetch,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isApiClientError(err) &&
        err.status === 409 &&
        err.code === 'ERR_CONCURRENCY_CONFLICT' &&
        err.conflictDetails?.current_version === 5 &&
        err.conflictDetails?.submitted_version === 3,
    );
  });
});

describe('SessionRequestManager & handleLogout abort-before-logout contract', () => {
  it('aborts all in-flight business queries and rotates controller BEFORE sending /auth/logout', async () => {
    const manager = new SessionRequestManager();
    const previousSignal = manager.getSignal();
    const events: string[] = [];

    previousSignal.addEventListener('abort', () => {
      events.push('in_flight_aborted');
    });

    setActiveCsrfToken('logout_csrf_token');
    const clearSpy = vi.fn();
    const navigateSpy = vi.fn();

    const mockFetch: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('/api/v1/auth/logout');
      expect(previousSignal.aborted).toBe(true);
      expect(manager.getSignal().aborted).toBe(false);
      expect(init?.signal?.aborted).toBe(false);
      const headers = new Headers(init?.headers);
      expect(headers.get('x-csrf-token')).toBe('logout_csrf_token');
      events.push('logout_post_sent');
      return jsonResponse({ success: true }, 200);
    });

    const outcome = await handleLogout(
      { clear: clearSpy },
      { fetchImpl: mockFetch, requestManager: manager, navigate: navigateSpy },
    );

    expect(events).toEqual(['in_flight_aborted', 'logout_post_sent']);
    expect(outcome).toEqual({ serverLogoutOk: true, redirectTo: '/login' });
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(getActiveCsrfToken()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });

  it('clears cache and redirects with ?warning=session_unconfirmed when server logout fails', async () => {
    const manager = new SessionRequestManager();
    setActiveCsrfToken('logout_csrf_token');
    const clearSpy = vi.fn();
    const navigateSpy = vi.fn();

    const failingFetch: typeof fetch = vi.fn(async () => {
      throw new TypeError('Network unreachable');
    });

    const outcome = await handleLogout(
      { clear: clearSpy },
      { fetchImpl: failingFetch, requestManager: manager, navigate: navigateSpy },
    );

    expect(outcome).toEqual({
      serverLogoutOk: false,
      redirectTo: '/login?warning=session_unconfirmed',
    });
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/login?warning=session_unconfirmed');
  });
});

describe('cross-session mutation generation binding (P1 security regression)', () => {
  it('aborts old POST mutation and rejects stale CSRF write when abortAndRotate() occurs during CSRF prefetch', async () => {
    const manager = new SessionRequestManager();
    clearActiveCsrfToken();

    let resolveCsrf: ((value: Response) => void) | undefined;
    let markCsrfStarted: (() => void) | undefined;
    const csrfStartedPromise = new Promise<void>((resolve) => {
      markCsrfStarted = resolve;
    });

    let postCalls = 0;
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        markCsrfStarted?.();
        return new Promise<Response>((resolve) => {
          resolveCsrf = resolve;
        });
      }
      postCalls += 1;
      return jsonResponse({ pat: { id: '1' }, rawToken: 'should_never_happen' }, 200);
    });

    const pendingMutation = apiRequest('/api/v1/pats', {
      method: 'POST',
      body: { name: 'UserA-Stale-PAT', expiresDays: 30 },
      fetchImpl: mockFetch,
      requestManager: manager,
    });

    await csrfStartedPromise;
    // Simulate account switch to User B while User A's mutation is waiting for CSRF prefetch
    manager.abortAndRotate();
    setActiveCsrfToken('user_b_fresh_csrf');

    // Now resolve User A's stale CSRF response
    resolveCsrf?.(jsonResponse({ csrfToken: 'user_a_stale_csrf' }, 200));

    await expect(pendingMutation).rejects.toMatchObject({ name: 'AbortError' });
    expect(postCalls).toBe(0);
    // User A's stale CSRF token MUST NOT overwrite User B's CSRF cache
    expect(getActiveCsrfToken()).toBe('user_b_fresh_csrf');
  });

  it('aborts old POST mutation before retry when abortAndRotate() occurs after 403 ERR_CSRF_INVALID', async () => {
    const manager = new SessionRequestManager();
    setActiveCsrfToken('user_a_expired_csrf');

    let postCalls = 0;
    let csrfRefreshCalls = 0;
    let resolveCsrfRefresh: ((value: Response) => void) | undefined;
    let markCsrfRefreshStarted: (() => void) | undefined;
    const csrfRefreshStarted = new Promise<void>((resolve) => {
      markCsrfRefreshStarted = resolve;
    });

    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === '/api/v1/pats') {
        postCalls += 1;
        if (postCalls === 1) {
          return jsonResponse(
            { code: 'ERR_CSRF_INVALID', message: 'CSRF invalid', action_guidance: 'retry' },
            403,
          );
        }
        return jsonResponse({ pat: { id: '999' }, rawToken: 'must_never_issue_for_user_b' }, 200);
      }
      if (url === '/api/v1/auth/csrf') {
        csrfRefreshCalls += 1;
        markCsrfRefreshStarted?.();
        return new Promise<Response>((resolve) => {
          resolveCsrfRefresh = resolve;
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const pendingMutation = apiRequest('/api/v1/pats', {
      method: 'POST',
      body: { name: 'UserA-Retry-Hijack-PAT', expiresDays: 30 },
      fetchImpl: mockFetch,
      requestManager: manager,
    });

    await csrfRefreshStarted;
    // Rotate session to User B BEFORE retry executes
    manager.abortAndRotate();
    setActiveCsrfToken('user_b_csrf');

    // Even if the in-flight CSRF refresh resolves after rotation, old mutation MUST abort and NEVER retry POST
    resolveCsrfRefresh?.(jsonResponse({ csrfToken: 'stale_retry_csrf' }, 200));

    await expect(pendingMutation).rejects.toMatchObject({ name: 'AbortError' });
    expect(postCalls).toBe(1);
    expect(csrfRefreshCalls).toBe(1);
    expect(getActiveCsrfToken()).toBe('user_b_csrf');
  });

  it('aborts immediately when abortAndRotate() occurs while awaiting first POST 403 response before CSRF refresh starts', async () => {
    const manager = new SessionRequestManager();
    setActiveCsrfToken('user_a_csrf');

    let postCalls = 0;
    let csrfRefreshCalls = 0;
    let resolveFirstPost: ((value: Response) => void) | undefined;
    let markPostStarted: (() => void) | undefined;
    const postStarted = new Promise<void>((resolve) => {
      markPostStarted = resolve;
    });

    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === '/api/v1/pats') {
        postCalls += 1;
        markPostStarted?.();
        return new Promise<Response>((resolve) => {
          resolveFirstPost = resolve;
        });
      }
      if (url === '/api/v1/auth/csrf') {
        csrfRefreshCalls += 1;
        return jsonResponse({ csrfToken: 'should_not_be_fetched' }, 200);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const pendingMutation = apiRequest('/api/v1/pats', {
      method: 'POST',
      body: { name: 'UserA-Inflight-PAT', expiresDays: 30 },
      fetchImpl: mockFetch,
      requestManager: manager,
    });

    await postStarted;
    manager.abortAndRotate();
    // Simulate a mock fetch that ignores signal and resolves with 403 ERR_CSRF_INVALID anyway
    resolveFirstPost?.(
      jsonResponse(
        { code: 'ERR_CSRF_INVALID', message: 'CSRF invalid', action_guidance: 'retry' },
        403,
      ),
    );

    await expect(pendingMutation).rejects.toMatchObject({ name: 'AbortError' });
    expect(postCalls).toBe(1);
    expect(csrfRefreshCalls).toBe(0);
  });
});
