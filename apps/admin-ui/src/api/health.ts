export interface HealthEndpointResult {
  endpoint: '/health/live' | '/health/ready';
  ok: boolean;
  httpStatus: number | null;
  statusText: string;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface AdminApiHealthSnapshot {
  live: HealthEndpointResult;
  ready: HealthEndpointResult;
}

function isStatusBody(value: unknown): value is { status: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof (value as { status?: unknown }).status === 'string'
  );
}

async function probeEndpoint(
  endpoint: '/health/live' | '/health/ready',
  signal?: AbortSignal,
): Promise<HealthEndpointResult> {
  const started = performance.now();
  const timeoutSignal = AbortSignal.timeout(4000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: combinedSignal,
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    const checkedAt = new Date().toISOString();
    let statusText = `HTTP ${response.status}`;

    try {
      const parsed: unknown = await response.json();
      if (isStatusBody(parsed)) {
        statusText = parsed.status;
      }
    } catch {
      statusText = response.statusText || statusText;
    }

    return {
      endpoint,
      ok: response.ok,
      httpStatus: response.status,
      statusText,
      latencyMs,
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    return {
      endpoint,
      ok: false,
      httpStatus: null,
      statusText: 'unreachable',
      latencyMs,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function fetchAdminApiHealth(signal?: AbortSignal): Promise<AdminApiHealthSnapshot> {
  const [live, ready] = await Promise.all([
    probeEndpoint('/health/live', signal),
    probeEndpoint('/health/ready', signal),
  ]);
  return { live, ready };
}
