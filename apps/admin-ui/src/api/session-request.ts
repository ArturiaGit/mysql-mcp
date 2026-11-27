export interface SessionRequestBinding {
  readonly signal: AbortSignal;
  readonly generation: number;
}

/**
 * Generational AbortController manager for authenticated API traffic.
 *
 * On logout, 401 expiration, or login account switch, `abortAndRotate()`
 * increments the monotonic `generation`, rotates to a brand-new AbortController,
 * and aborts every in-flight business request bound to the previous generation.
 */
export class SessionRequestManager {
  private currentController: AbortController = new AbortController();
  private generation = 0;

  public getSignal(): AbortSignal {
    return this.currentController.signal;
  }

  public getGeneration(): number {
    return this.generation;
  }

  public beginRequest(): SessionRequestBinding {
    return {
      signal: this.currentController.signal,
      generation: this.generation,
    };
  }

  public isCurrent(binding: SessionRequestBinding): boolean {
    return !binding.signal.aborted && this.generation === binding.generation;
  }

  public abortAndRotate(): AbortSignal {
    const previous = this.currentController;
    this.generation += 1;
    this.currentController = new AbortController();
    previous.abort(new DOMException('Session rotated or logged out', 'AbortError'));
    return this.currentController.signal;
  }
}

export const sessionRequestManager = new SessionRequestManager();
