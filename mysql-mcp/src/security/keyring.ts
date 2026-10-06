import type { AsyncEntry } from '@napi-rs/keyring';

export interface ICredentialProvider {
  getCredential(ref: string): Promise<string | null>;
  setCredential(ref: string, secret: string): Promise<void>;
  deleteCredential(ref: string): Promise<void>;
}

// The native seam is explicit, typed and never selected as a fallback.
export type KeyringEntry = Pick<AsyncEntry, 'getPassword' | 'setPassword' | 'deletePassword'>;
export interface KeyringModule {
  AsyncEntry: new (service: string, username: string) => KeyringEntry;
}
export type KeyringLoader = () => Promise<KeyringModule>;

export class CredentialStoreError extends Error {
  readonly code = 'CREDENTIAL_STORE_UNAVAILABLE';

  constructor() {
    super('Credential store is unavailable.');
    this.name = 'CredentialStoreError';
    // Neither native exceptions nor local filesystem paths leave this boundary.
    this.stack = `${this.name}: ${this.code}`;
  }
}

export class CredentialArgumentError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  constructor() {
    super('Invalid credential argument.');
    this.name = 'CredentialArgumentError';
    this.stack = `${this.name}: ${this.code}`;
  }
}

function validateRef(ref: string): void {
  // A ref is a connection ID, not a path or an already-prefixed service name.
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ref) || /[\r\n]/.test(ref)) {
    throw new CredentialArgumentError();
  }
}

function validateSecret(secret: string): void {
  // A conservative bound below the Windows credential blob limit.
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1024 || secret.includes('\0') ||
      Buffer.from(secret, 'utf8').toString('utf8') !== secret || Buffer.byteLength(secret, 'utf8') > 1024) {
    throw new CredentialArgumentError();
  }
}

export class WindowsKeyringProvider implements ICredentialProvider {
  constructor(private readonly loadKeyring: KeyringLoader = () => import('@napi-rs/keyring')) {}

  private async entry(ref: string): Promise<KeyringEntry> {
    if (process.platform !== 'win32') throw new CredentialStoreError();
    const keyring = await this.loadKeyring();
    return new keyring.AsyncEntry(`mysql-mcp:${ref}`, 'mysql-mcp');
  }

  async getCredential(ref: string): Promise<string | null> {
    validateRef(ref);
    try {
      const value = await (await this.entry(ref)).getPassword();
      return value ?? null;
    } catch {
      throw new CredentialStoreError();
    }
  }

  async setCredential(ref: string, secret: string): Promise<void> {
    validateRef(ref);
    validateSecret(secret);
    try {
      await (await this.entry(ref)).setPassword(secret);
    } catch {
      throw new CredentialStoreError();
    }
  }

  async deleteCredential(ref: string): Promise<void> {
    validateRef(ref);
    try {
      await (await this.entry(ref)).deletePassword();
    } catch {
      throw new CredentialStoreError();
    }
  }

  // Strongly typed aliases for native-style callers; identical validation/boundary.
  getPassword(ref: string): Promise<string | null> {
    return this.getCredential(ref);
  }

  setPassword(ref: string, secret: string): Promise<void> {
    return this.setCredential(ref, secret);
  }

  deletePassword(ref: string): Promise<void> {
    return this.deleteCredential(ref);
  }
}
