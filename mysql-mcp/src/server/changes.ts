import type { FastifyInstance } from 'fastify';
import { LocalAuth } from './auth.js';
import { objectBody } from './connections.js';
import { ChangeManager } from '../changes/manager.js';

export function registerChangeRoutes(app: FastifyInstance, auth: LocalAuth, changes: ChangeManager): void {
  app.get('/api/v1/changes', async request => {
    objectBody(request.query, []);
    return { ok: true, data: await changes.list() };
  });
  app.get<{ Params: { request_id: string } }>('/api/v1/changes/:request_id', async request => {
    objectBody(request.query, []);
    const browser = auth.authenticate(request.headers.cookie);
    return { ok: true, data: await changes.detail(request.params.request_id, browser) };
  });
  app.post<{ Params: { request_id: string } }>('/api/v1/changes/:request_id/decision', async request => {
    objectBody(request.query, []);
    const browser = auth.authenticate(request.headers.cookie, request.headers['x-csrf-token'] as string, true);
    return { ok: true, data: await changes.decide(request.params.request_id, request.body, browser) };
  });
}
