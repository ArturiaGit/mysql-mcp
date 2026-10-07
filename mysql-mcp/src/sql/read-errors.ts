import { SqlPolicyError } from './ast.js';
import { CredentialArgumentError, CredentialStoreError } from '../security/keyring.js';
import { ServerError } from '../server/errors.js';

const messages = {
  INVALID_ARGUMENT: 'Invalid tool arguments.',
  NOT_FOUND: 'The requested target was not found or is not visible.',
  SQL_NOT_ALLOWED: 'SQL is outside the supported read-only policy.',
  TARGET_MISMATCH: 'SQL does not match the explicit database target.',
  STATE_CONFLICT: 'The connection is currently unavailable for this operation.',
  DB_ACCESS_DENIED: 'Database access was denied.',
  DB_ERROR: 'The database operation failed.',
  EXECUTION_TIMEOUT: 'The read operation exceeded its execution budget or was cancelled.',
  RESOURCE_LIMIT: 'Read resource limit reached.',
  CREDENTIAL_STORE_UNAVAILABLE: 'Credential store is unavailable.',
  SERVICE_UNAVAILABLE: 'Read service is unavailable.',
  INTERNAL_ERROR: 'Internal read service error.'
} as const;
export type ReadErrorCode = keyof typeof messages;
export class ReadError extends Error {
  constructor(readonly code: ReadErrorCode) {
    super(messages[code]);
    this.name = 'ReadError';
    this.stack = `${this.name}: ${code}`;
  }
}
export function readError(error: unknown): { code: ReadErrorCode; message: string } {
  let code: ReadErrorCode = 'INTERNAL_ERROR';
  if (error instanceof ReadError) code = error.code;
  else if (error instanceof SqlPolicyError) code = 'SQL_NOT_ALLOWED';
  else if (error instanceof CredentialStoreError) code = 'CREDENTIAL_STORE_UNAVAILABLE';
  else if (error instanceof CredentialArgumentError) code = 'INVALID_ARGUMENT';
  else if (error instanceof ServerError && Object.hasOwn(messages, error.code)) code = error.code as ReadErrorCode;
  return { code, message: messages[code] };
}
// Native errors are classified only at the driver boundary. No text is retained.
export function databaseError(error: unknown): ReadError {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR'].includes(String(code))) return new ReadError('DB_ACCESS_DENIED');
  if (['ER_QUERY_TIMEOUT', 'ER_QUERY_INTERRUPTED'].includes(String(code))) return new ReadError('EXECUTION_TIMEOUT');
  if (['ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE'].includes(String(code))) return new ReadError('NOT_FOUND');
  return new ReadError('DB_ERROR');
}
