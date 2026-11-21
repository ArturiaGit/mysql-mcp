import { createHmac, randomBytes } from 'node:crypto';

export function createPatToken(): string {
  return `mcp_pat_${randomBytes(32).toString('hex')}`;
}

export function hashPatToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}
