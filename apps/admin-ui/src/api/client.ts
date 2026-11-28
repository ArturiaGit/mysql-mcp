import type { ConflictErrorDetailsDTO, UserStatus } from '@mysql-mcp/shared-types';
import type { QueryClient } from '@tanstack/react-query';
import type * as z from 'zod/v4-mini';
import {
  CsrfTokenSchema,
  StandardErrorResponseSchema,
  type ValidationErrorItem,
} from './schemas/auth.schema';
import {
  sessionRequestManager,
  type SessionRequestBinding,
  type SessionRequestManager,
} from './session-request';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001F\u007F]/;

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly actionGuidance: string;
  public readonly timestamp?: string;
  public readonly remainingAttempts?: number;
  public readonly retryAfterSec?: number;
  public readonly validationErrors?: ValidationErrorItem[];
  public readonly conflictDetails?: ConflictErrorDetailsDTO;
  public readonly currentStatus?: UserStatus;
  public readonly requiredRoles?: string[];
  public readonly isNetworkError: boolean;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    actionGuidance?: string;
    timestamp?: string;
    remainingAttempts?: number;
    retryAfterSec?: number;
    validationErrors?: ValidationErrorItem[];
    conflictDetails?: ConflictErrorDetailsDTO;
    currentStatus?: UserStatus;
    requiredRoles?: string[];
    isNetworkError?: boolean;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.status = params.status;
    this.code = params.code;
    this.actionGuidance = params.actionGuidance ?? '请检查输入或稍后重试。';
    this.timestamp = params.timestamp;
    this.remainingAttempts = params.remainingAttempts;
    this.retryAfterSec = params.retryAfterSec;
    this.validationErrors = params.validationErrors;
    this.conflictDetails = params.conflictDetails;
    this.currentStatus = params.currentStatus;
    this.requiredRoles = params.requiredRoles;
    this.isNetworkError = params.isNetworkError ?? false;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

function createSessionAbortError(): DOMException {
  return new DOMException('Session rotated or logged out', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * Strictly sanitizes post-login redirect targets to prevent open redirects,
 * backslash smuggling, ASCII control characters, cross-origin URLs, and
 * path-traversal `//` protocol-relative escapes.
 */
export function sanitizeReturnUrl(
  rawUrl: string | null | undefined,
  fallback = '/dashboard',
  baseOrigin?: string,
): string {
  if (!rawUrl || !rawUrl.trim()) {
    return fallback;
  }
  if (CONTROL_OR_BACKSLASH.test(rawUrl)) {
    return fallback;
  }

  const origin =
    baseOrigin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  try {
    const parsed = new URL(rawUrl, origin);
    if (parsed.origin !== origin) {
      return fallback;
    }
    if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
      return fallback;
    }
    const safePath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!safePath.startsWith('/') || safePath.startsWith('//')) {
      return fallback;
    }
    return safePath;
  } catch {
    return fallback;
  }
}

interface CsrfRefreshEntry {
  manager: SessionRequestManager;
  generation: number;
  promise: Promise<string>;
}

let activeCsrfToken: string | null = null;
let csrfRefreshEntry: CsrfRefreshEntry | null = null;
let unauthorizedHandler: ((currentPath: string) => void) | null = null;

export function setActiveCsrfToken(token: string | null): void {
  activeCsrfToken = token;
}

export function getActiveCsrfToken(): string | null {
  return activeCsrfToken;
}

export function clearActiveCsrfToken(): void {
  activeCsrfToken = null;
  csrfRefreshEntry = null;
}

export function registerUnauthorizedHandler(handler: ((currentPath: string) => void) | null): void {
  unauthorizedHandler = handler;
}

export interface CsrfRequestOptions {
  signal?: AbortSignal;
  requestManager?: SessionRequestManager;
  binding?: SessionRequestBinding;
}

function assertCsrfSessionCurrent(
  manager: SessionRequestManager,
  expectedGeneration: number,
  signal?: AbortSignal,
  binding?: SessionRequestBinding,
): void {
  if (signal?.aborted) {
    throw createSessionAbortError();
  }
  if (binding && !manager.isCurrent(binding)) {
    throw createSessionAbortError();
  }
  if (manager.getGeneration() !== expectedGeneration) {
    throw createSessionAbortError();
  }
}

export async function refreshCsrfToken(
  fetchImpl: typeof fetch = fetch,
  options: CsrfRequestOptions = {},
): Promise<string> {
  const manager = options.requestManager ?? sessionRequestManager;
  const binding = options.binding;
  const expectedGeneration = binding ? binding.generation : manager.getGeneration();
  const signal = options.signal ?? binding?.signal;

  assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);

  if (
    !csrfRefreshEntry ||
    csrfRefreshEntry.manager !== manager ||
    csrfRefreshEntry.generation !== expectedGeneration
  ) {
    const refreshPromise = Promise.resolve()
      .then(async () => {
        assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);
        const response = await fetchImpl('/api/v1/auth/csrf', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal,
        });
        assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);
        if (!response.ok) {
          throw await buildErrorFromResponse(response);
        }
        const json: unknown = await response.json();
        assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);
        const parsed = CsrfTokenSchema.safeParse(json);
        if (!parsed.success) {
          throw new ApiClientError({
            status: response.status,
            code: 'ERR_INVALID_RESPONSE',
            message: 'CSRF 响应契约校验失败。',
            actionGuidance: '请刷新页面后重试。',
          });
        }
        // Only write to shared CSRF cache if session generation is still active
        assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);
        activeCsrfToken = parsed.data.csrfToken;
        return parsed.data.csrfToken;
      })
      .finally(() => {
        if (csrfRefreshEntry?.promise === refreshPromise) {
          csrfRefreshEntry = null;
        }
      });

    csrfRefreshEntry = {
      manager,
      generation: expectedGeneration,
      promise: refreshPromise,
    };
  }

  const token = await csrfRefreshEntry.promise;
  assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);
  return token;
}

export async function getOrRefreshCsrfToken(
  fetchImpl: typeof fetch = fetch,
  options: CsrfRequestOptions = {},
): Promise<string> {
  const manager = options.requestManager ?? sessionRequestManager;
  const binding = options.binding;
  const expectedGeneration = binding ? binding.generation : manager.getGeneration();
  const signal = options.signal ?? binding?.signal;

  assertCsrfSessionCurrent(manager, expectedGeneration, signal, binding);

  if (activeCsrfToken) {
    return activeCsrfToken;
  }
  return refreshCsrfToken(fetchImpl, options);
}

async function buildErrorFromResponse(response: Response): Promise<ApiClientError> {
  const rawBody: unknown = await response.json().catch(() => null);
  const parsed = StandardErrorResponseSchema.safeParse(rawBody);
  if (parsed.success) {
    const details = parsed.data.details;
    const conflictDetails =
      details?.current_version !== undefined && details?.submitted_version !== undefined
        ? {
            current_version: details.current_version,
            submitted_version: details.submitted_version,
          }
        : undefined;

    return new ApiClientError({
      status: response.status,
      code: parsed.data.code,
      message: parsed.data.message,
      actionGuidance: parsed.data.action_guidance,
      timestamp: parsed.data.timestamp,
      remainingAttempts: parsed.data.remaining_attempts,
      retryAfterSec: parsed.data.retry_after_sec,
      validationErrors: details?.validation_errors,
      conflictDetails,
      currentStatus: details?.current_status,
      requiredRoles: details?.requiredRoles,
    });
  }

  return new ApiClientError({
    status: response.status,
    code: response.status >= 500 ? 'ERR_INTERNAL_SERVER' : 'ERR_REQUEST_FAILED',
    message:
      response.status >= 500
        ? '网关服务暂时不可用或发生内部异常。'
        : `请求失败 (HTTP ${response.status})。`,
    actionGuidance:
      response.status >= 500
        ? '请确认后端服务状态后点击重试。'
        : '请检查请求参数后重试。',
  });
}

function combineSignals(
  sessionSignal: AbortSignal | undefined,
  callerSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (sessionSignal) {
    signals.push(sessionSignal);
  }
  if (callerSignal) {
    signals.push(callerSignal);
  }
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

export interface ApiRequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: z.ZodMiniType<T>;
  signal?: AbortSignal;
  useSessionSignal?: boolean;
  skipUnauthorizedRedirect?: boolean;
  retryCsrf?: boolean;
  fetchImpl?: typeof fetch;
  requestManager?: SessionRequestManager;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions<T> = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    schema,
    signal,
    useSessionSignal = true,
    skipUnauthorizedRedirect = false,
    retryCsrf = true,
    fetchImpl = fetch,
    requestManager = sessionRequestManager,
  } = options;

  // Capture session binding ONCE at request start; never re-read a rotated signal on retries.
  const sessionBinding = useSessionSignal ? requestManager.beginRequest() : undefined;
  const requestSignal = combineSignals(sessionBinding?.signal, signal);

  const assertRequestActive = (): void => {
    if (sessionBinding && !requestManager.isCurrent(sessionBinding)) {
      throw createSessionAbortError();
    }
    if (signal?.aborted) {
      throw createSessionAbortError();
    }
  };

  const csrfOptions: CsrfRequestOptions = {
    signal: requestSignal,
    requestManager,
    binding: sessionBinding,
  };

  const isMutating = MUTATING_METHODS.has(method);
  const executeOnce = async (csrfToken: string | null): Promise<Response> => {
    assertRequestActive();

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (isMutating && csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }

    try {
      const res = await fetchImpl(path, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: requestSignal,
      });
      assertRequestActive();
      return res;
    } catch (error: unknown) {
      if (isAbortError(error) || (sessionBinding && !requestManager.isCurrent(sessionBinding))) {
        throw isAbortError(error) ? error : createSessionAbortError();
      }
      throw new ApiClientError({
        status: 0,
        code: 'ERR_NETWORK',
        message: '网关网络连接异常或请求超时。',
        actionGuidance: '请检查本地网络或后端服务连通性后点击重试。',
        isNetworkError: true,
      });
    }
  };

  assertRequestActive();
  let token = isMutating ? await getOrRefreshCsrfToken(fetchImpl, csrfOptions) : null;
  assertRequestActive();
  let response = await executeOnce(token);

  if (!response.ok) {
    let apiError = await buildErrorFromResponse(response);
    assertRequestActive();

    if (
      isMutating &&
      retryCsrf &&
      response.status === 403 &&
      apiError.code === 'ERR_CSRF_INVALID'
    ) {
      token = await refreshCsrfToken(fetchImpl, csrfOptions);
      assertRequestActive();
      response = await executeOnce(token);
      if (!response.ok) {
        apiError = await buildErrorFromResponse(response);
        assertRequestActive();
      }
    }

    if (!response.ok) {
      assertRequestActive();
      if (
        response.status === 401 &&
        !skipUnauthorizedRedirect &&
        path !== '/api/v1/auth/login' &&
        unauthorizedHandler
      ) {
        const currentPath =
          typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}${window.location.hash}`
            : '/dashboard';
        unauthorizedHandler(currentPath);
      }
      throw apiError;
    }
  }

  const payload: unknown = await response.json();
  assertRequestActive();
  if (schema) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError({
        status: response.status,
        code: 'ERR_INVALID_RESPONSE',
        message: '接口响应数据结构不符合契约定义。',
        actionGuidance: '请刷新页面或联系管理员检查网关版本。',
      });
    }
    return parsed.data;
  }

  return payload as T;
}

export interface LogoutOptions {
  fetchImpl?: typeof fetch;
  requestManager?: SessionRequestManager;
  navigate?: (targetUrl: string) => void;
  timeoutMs?: number;
}

/**
 * Standard logout sequence (FRONTEND_ARCHITECTURE_SPEC.md §4.1):
 * 1. Abort all in-flight business requests & rotate AbortController
 * 2. POST /api/v1/auth/logout with CSRF token + independent 5s timeout (single retry ONLY on ERR_CSRF_INVALID)
 * 3. Clear active CSRF token + TanStack Query cache in finally
 * 4. Redirect to /login (or /login?warning=session_unconfirmed if server logout unconfirmed)
 */
export async function handleLogout(
  queryClient: Pick<QueryClient, 'clear'>,
  options: LogoutOptions = {},
): Promise<{ serverLogoutOk: boolean; redirectTo: string }> {
  const {
    fetchImpl = fetch,
    requestManager = sessionRequestManager,
    navigate,
    timeoutMs = 5_000,
  } = options;

  // Step 1: physically abort previous session traffic and rotate controller for next session
  requestManager.abortAndRotate();

  // Step 2: send server logout using independent timeout signal
  let serverLogoutOk = false;
  try {
    const token = await getOrRefreshCsrfToken(fetchImpl, { requestManager });
    const response = await fetchImpl('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'x-csrf-token': token,
      },
      credentials: 'include',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      serverLogoutOk = true;
    } else if (response.status === 403) {
      const error = await buildErrorFromResponse(response);
      if (error.code === 'ERR_CSRF_INVALID') {
        const refreshedToken = await refreshCsrfToken(fetchImpl, { requestManager });
        const retryResponse = await fetchImpl('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'x-csrf-token': refreshedToken,
          },
          credentials: 'include',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (retryResponse.ok) {
          serverLogoutOk = true;
        }
      }
    }
  } catch {
    // Server logout could not be confirmed; proceed to clear local state and warn user on /login
  } finally {
    // Step 3: clear in-memory CSRF token and query cache unconditionally
    clearActiveCsrfToken();
    queryClient.clear();
  }

  // Step 4: redirect with explicit warning when server logout was unconfirmed
  const redirectTo = serverLogoutOk ? '/login' : '/login?warning=session_unconfirmed';
  if (navigate) {
    navigate(redirectTo);
  } else if (typeof window !== 'undefined') {
    window.location.assign(redirectTo);
  }

  return { serverLogoutOk, redirectTo };
}
