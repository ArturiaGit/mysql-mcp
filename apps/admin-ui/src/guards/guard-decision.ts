import type { CurrentUserResponseDTO, SystemRole, UserStatus } from '@mysql-mcp/shared-types';
import { sanitizeReturnUrl } from '@/api/client';

export type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string; stage: 'L1_AUTH' | 'L2_STATUS' | 'L3_MUST_CHANGE_PWD' }
  | { kind: 'forbidden'; stage: 'L4_ROLE'; requiredRoles: readonly SystemRole[] };

export interface GuardPipelineOptions {
  currentPath: string;
  allowedStatuses?: readonly UserStatus[];
  bypassPasswordGuard?: boolean;
  requiredRoles?: readonly SystemRole[];
}

export function statusHomePath(user: CurrentUserResponseDTO): string {
  switch (user.status) {
    case 'PENDING':
      return '/approvals/wait';
    case 'REJECTED':
      return '/approvals/re';
    case 'DISABLED':
      return '/forbidden';
    case 'ACTIVE':
      return user.must_change_password || user.is_password_expired
        ? '/change-password'
        : '/dashboard';
  }
}

export function postLoginRedirectPath(
  user: CurrentUserResponseDTO,
  rawReturnUrl: string | null | undefined,
): string {
  // L2 StatusGuard always takes absolute priority before returnUrl or password guard.
  if (user.status !== 'ACTIVE') {
    return statusHomePath(user);
  }
  // L3 MustChangePwdGuard (ONLY for ACTIVE users).
  if (user.must_change_password || user.is_password_expired) {
    return '/change-password';
  }
  const safeTarget = sanitizeReturnUrl(rawReturnUrl, '/dashboard');
  if (
    safeTarget === '/login' ||
    safeTarget.startsWith('/login?') ||
    safeTarget === '/register' ||
    safeTarget.startsWith('/register?')
  ) {
    return '/dashboard';
  }
  return safeTarget;
}

/**
 * Pure deterministic evaluator for the 4-layer guard pipeline:
 * L1 AuthGuard -> L2 StatusGuard -> L3 MustChangePwdGuard (ACTIVE only) -> L4 RoleGuard.
 */
export function evaluateGuardPipeline(
  user: CurrentUserResponseDTO | null,
  options: GuardPipelineOptions,
): GuardDecision {
  const {
    currentPath,
    allowedStatuses = ['ACTIVE'],
    bypassPasswordGuard = false,
    requiredRoles,
  } = options;

  // L1: AuthGuard
  if (!user) {
    const safeReturn = sanitizeReturnUrl(currentPath, '/dashboard');
    const query = safeReturn === '/dashboard' ? '' : `?returnUrl=${encodeURIComponent(safeReturn)}`;
    return { kind: 'redirect', to: `/login${query}`, stage: 'L1_AUTH' };
  }

  // L2: StatusGuard (strictly BEFORE MustChangePwdGuard; restricted users never hit L3)
  if (!allowedStatuses.includes(user.status)) {
    return { kind: 'redirect', to: statusHomePath(user), stage: 'L2_STATUS' };
  }

  if (user.status !== 'ACTIVE') {
    // Restricted user on their permitted status page (/approvals/wait, /approvals/re, /forbidden)
    return { kind: 'allow' };
  }

  // L3: MustChangePwdGuard (ONLY ACTIVE users)
  if (!bypassPasswordGuard && (user.must_change_password || user.is_password_expired)) {
    return { kind: 'redirect', to: '/change-password', stage: 'L3_MUST_CHANGE_PWD' };
  }

  // L4: RoleGuard (ONLY ACTIVE + password valid)
  if (requiredRoles && requiredRoles.length > 0) {
    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      return { kind: 'forbidden', stage: 'L4_ROLE', requiredRoles };
    }
  }

  return { kind: 'allow' };
}
