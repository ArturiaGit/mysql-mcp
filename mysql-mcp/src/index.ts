export const APP_NAME = 'mysql-mcp';
export const APP_VERSION = '0.1.0-alpha.0';

export interface Application {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
}

// This scaffold is inert: no listeners, database connections or credential access.
export function createApplication(): Readonly<Application> {
  return Object.freeze({ name: APP_NAME, version: APP_VERSION });
}
