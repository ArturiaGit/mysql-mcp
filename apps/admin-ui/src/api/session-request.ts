/**
 * Generational AbortController manager for authenticated API traffic.
 *
 * On logout, `abortAndRotate()` immediately aborts every in-flight business
 * request belonging to the previous session and rotates to a brand-new
 * AbortController so subsequent sessions start with a clean non-aborted signal.
 */
export class SessionRequestManager {
  private currentController: AbortController = new AbortController();

  public getSignal(): AbortSignal {
    return this.currentController.signal;
  }

  public abortAndRotate(): AbortSignal {
    const previous = this.currentController;
    this.currentController = new AbortController();
    previous.abort(new DOMException('Session rotated or logged out', 'AbortError'));
    return this.currentController.signal;
  }
}

export const sessionRequestManager = new SessionRequestManager();
