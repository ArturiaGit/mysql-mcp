import type { CurrentUserResponseDTO } from '@mysql-mcp/shared-types';
import type { QueryClient } from '@tanstack/react-query';
import { AUTH_ME_QUERY_KEY } from './auth';
import { clearActiveCsrfToken } from './client';
import { sessionRequestManager, type SessionRequestManager } from './session-request';

type ResettableQueryClient = Pick<QueryClient, 'cancelQueries' | 'clear' | 'setQueryData'>;

/**
 * Full session cache & request reset on HTTP 401 expiration:
 * 1. Abort all in-flight session requests and rotate AbortController.
 * 2. Cancel active TanStack Query fetches so stale responses cannot re-populate cache.
 * 3. Clear in-memory CSRF token.
 * 4. Clear EVERY cached query across all namespaces (auth, developer, etc.).
 */
export function resetSessionCacheOnUnauthorized(
  queryClient: Pick<QueryClient, 'cancelQueries' | 'clear'>,
  requestManager: SessionRequestManager = sessionRequestManager,
): void {
  requestManager.abortAndRotate();
  void queryClient.cancelQueries();
  clearActiveCsrfToken();
  queryClient.clear();
}

/**
 * Full session cache isolation when completing login (including direct `/login` account switch
 * without clicking logout):
 * 1. Abort any lingering in-flight requests from a prior user session and rotate AbortController.
 * 2. Cancel active queries so prior-user responses cannot land after login.
 * 3. Clear the entire QueryClient cache before seeding ONLY the newly authenticated user's `['auth', 'me']`.
 * Note: Preserves the freshly rotated post-login CSRF token already fetched by `loginWithPassword`.
 */
export function resetSessionCacheForLogin(
  queryClient: ResettableQueryClient,
  currentUser: CurrentUserResponseDTO,
  requestManager: SessionRequestManager = sessionRequestManager,
): void {
  requestManager.abortAndRotate();
  void queryClient.cancelQueries();
  queryClient.clear();
  queryClient.setQueryData(AUTH_ME_QUERY_KEY, currentUser);
}
