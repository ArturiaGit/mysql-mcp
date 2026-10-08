import { CredentialArgumentError, CredentialStoreError } from '../security/keyring.js';

const errors = {
  INVALID_ARGUMENT: [400, 'Invalid request.'],
  UNAUTHENTICATED: [401, 'A valid local session is required.'],
  FORBIDDEN: [403, 'Request is forbidden.'],
  NOT_FOUND: [404, 'Connection or route was not found.'],
  STATE_CONFLICT: [409, 'Connection state or version has changed.'],
  CONNECTION_CHANGED: [409, 'The connection changed; the approval is invalid.'],
  APPROVAL_EXPIRED: [409, 'The approval has expired.'],
  SQL_NOT_ALLOWED: [422, 'SQL is outside the supported safety policy.'],
  TARGET_MISMATCH: [422, 'SQL does not match the explicit database target.'],
  DB_ACCESS_DENIED: [403, 'Database access was denied.'],
  DB_ERROR: [502, 'The database returned an error.'],
  RESOURCE_LIMIT: [429, 'Resource limit reached.'],
  EXECUTION_TIMEOUT: [504, 'Execution exceeded its time budget.'],
  CREDENTIAL_STORE_UNAVAILABLE: [503, 'Credential store is unavailable.'],
  SERVICE_UNAVAILABLE: [503, 'Local storage or service is unavailable.'],
  INTERNAL_ERROR: [500, 'Internal service error.']
} as const;
export type ServerErrorCode = keyof typeof errors;

export class ServerError extends Error {
  constructor(readonly code: ServerErrorCode) {
    super(errors[code][1]);
    this.name = 'ServerError';
  }
}

// Never interpolate exception text, validation details, paths, inputs or stacks.
export function sanitizeError(error: unknown): {
  status: number; body: { ok: false; error: { code: ServerErrorCode; message: string } };
} {
  const code = error instanceof ServerError ? error.code :
    error instanceof CredentialArgumentError ? 'INVALID_ARGUMENT' :
    error instanceof CredentialStoreError ? 'CREDENTIAL_STORE_UNAVAILABLE' : 'INTERNAL_ERROR';
  const [status, message] = errors[code];
  return { status, body: { ok: false, error: { code, message } } };
}
