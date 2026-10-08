import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ChangeManager } from '../changes/manager.js';
import { parseChangeInput, requestId } from '../changes/types.js';
import { objectBody } from '../server/connections.js';
import { ServerError, sanitizeError } from '../server/errors.js';

const uuid = { type: 'string', minLength: 36, maxLength: 36, pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
export function changeTools(): Tool[] {
  return [{ name: 'request_change', description: 'Request an exact DML/DDL change. Human approval is required; this tool cannot approve it.',
    inputSchema: { type: 'object', properties: { connection_id: { ...uuid }, database: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' },
      sql: { type: 'string', minLength: 1, maxLength: 65_536 }, reason: { type: 'string', minLength: 1, maxLength: 2048 } },
      required: ['connection_id', 'database', 'sql'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
  { name: 'get_change_status', description: 'Query the original change status in this MCP session. Never retries SQL.',
    inputSchema: { type: 'object', properties: { request_id: { ...uuid } }, required: ['request_id'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }];
}
export class ChangeToolService {
  readonly session: string | undefined;
  private closed = false;
  constructor(private readonly changes?: ChangeManager) { this.session = changes?.openSession(); }
  close(): void { if (!this.closed && this.session) this.changes?.closeSession(this.session); this.closed = true; }
  async call(name: string, value: unknown, signal?: AbortSignal): Promise<CallToolResult> {
    try {
      if (name === 'request_change') parseChangeInput(value);
      else if (name === 'get_change_status') requestId(objectBody(value, ['request_id'], ['request_id'])['request_id']);
      else throw new ServerError('INVALID_ARGUMENT');
      if (this.closed || !this.changes || !this.session) throw new ServerError('SERVICE_UNAVAILABLE');
      const data = name === 'request_change' ? await this.changes.create(this.session, value, signal) :
        await this.changes.status(this.session, (value as Record<string, unknown>)['request_id']);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }], isError: false };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify(sanitizeError(error).body) }], isError: true };
    }
  }
}
