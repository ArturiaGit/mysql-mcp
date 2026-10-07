export const APP_NAME = 'mysql-mcp';
export const APP_VERSION = '0.1.0-alpha.0';

export interface Application {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
}

// Importing the package remains inert: factories must be called explicitly.
export function createApplication(): Readonly<Application> {
  return Object.freeze({ name: APP_NAME, version: APP_VERSION });
}

export { WindowsKeyringProvider, CredentialStoreError, CredentialArgumentError } from './security/keyring.js';
export type { ICredentialProvider } from './security/keyring.js';
export { evaluateSql } from './sql/policy.js';
export type { SqlDecision, RiskLevel } from './sql/policy.js';
export { SqlPolicyError, MAX_SQL_BYTES, MAX_SQL_DEPTH, MAX_SQL_TOKENS } from './sql/ast.js';
export { createMcpServer, startStdioServer } from './mcp/server.js';
export { createLocalServer } from './server/app.js';
export type { LocalServerOptions } from './server/app.js';
export { ConnectionService, JsonMetadataStorage, simulatedConnectionTester } from './server/connections.js';
export type { ConnectionView, ConnectionDraft, MetadataStorage, ConnectionTester, TestResult } from './server/connections.js';
export { ServerError, sanitizeError } from './server/errors.js';
export { ReadToolService, readTools } from './mcp/tools.js';
export type { ReadConnections } from './mcp/tools.js';
export type { McpServerOptions } from './mcp/server.js';
export { prepareReadonlySql } from './sql/readonly.js';
export { READ_LIMITS, collectRows, responseBytes } from './sql/results.js';
export type { ColumnMeta, ReadRows, QueryResult } from './sql/results.js';
export { ReadError, readError, databaseError } from './sql/read-errors.js';
export { mysqlReadSession } from './sql/driver.js';
export type { ReadSession, ReadSessionFactory } from './sql/driver.js';
