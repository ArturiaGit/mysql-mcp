import { ApiError } from './errors.js';

export async function invalidateAfterCommit(
  onInvalidationFailure: () => void,
  synchronousSteps: readonly (() => undefined)[],
  cancellations: readonly (() => void | Promise<void>)[],
): Promise<void> {
  let failed = false;
  // Close admission on the first failure, but still attempt all remaining tombstones.
  for (const step of synchronousSteps) {
    try {
      step();
    } catch {
      if (!failed) {
        failed = true;
        onInvalidationFailure();
        console.error('admin-api post-commit synchronous invalidation failed; readiness remains closed');
      }
    }
  }
  // Only cancellations are concurrent; include synchronous throws in the best-effort phase.
  const results = await Promise.allSettled(cancellations.map(async (cancel) => cancel()));
  if (results.some((result) => result.status === 'rejected')) {
    console.warn('admin-api post-commit query cancellation failed');
  }
  if (failed) throw new ApiError(503, 'ERR_INTERNAL_SERVER');
}
