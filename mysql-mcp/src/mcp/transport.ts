import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import { READ_LIMITS } from '../sql/results.js';

/** Enforce budgets before SDK dispatch and on the complete serialized response. */
export class BudgetTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  private closed = false;
  constructor(private readonly inner: Transport) {}
  get sessionId(): string | undefined { return this.inner.sessionId; }
  setProtocolVersion(version: string): void { this.inner.setProtocolVersion?.(version); }
  async start(): Promise<void> {
    this.inner.onclose = () => { this.closed = true; this.onclose?.(); };
    this.inner.onerror = () => { this.onerror?.(new Error('MCP protocol error.')); };
    this.inner.onmessage = (message, extra) => {
      const id = 'id' in message ? message.id : undefined;
      if (this.closed) return;
      if ((id !== undefined && Buffer.byteLength(JSON.stringify(id)) > 256) ||
        Buffer.byteLength(JSON.stringify(message)) > READ_LIMITS.max_response_bytes) {
        this.onerror?.(new Error('MCP protocol budget exceeded.'));
        void this.close(); // Never echo an unbounded or secret-bearing identifier.
        return;
      }
      this.onmessage?.(message, extra);
    };
    await this.inner.start();
  }
  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (this.closed) throw new Error('MCP transport is closed.');
    if (Buffer.byteLength(JSON.stringify(message)) + 1 > READ_LIMITS.max_response_bytes) {
      await this.close();
      throw new Error('MCP protocol budget exceeded.');
    }
    await this.inner.send(message, options);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.inner.close();
  }
}
