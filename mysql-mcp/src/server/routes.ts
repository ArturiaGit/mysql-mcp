import type { FastifyInstance } from 'fastify';
import { LocalAuth, sessionCookie } from './auth.js';
import { ConnectionService, objectBody } from './connections.js';

const ok = (data: unknown): { ok: true; data: unknown } => ({ ok: true, data });
export function registerRoutes(app: FastifyInstance, auth: LocalAuth, connections: ConnectionService): void {
  app.post('/api/v1/session', async (request, reply) => {
    const body = objectBody(request.body, ['local_code'], ['local_code']);
    const session = auth.exchange(body['local_code']);
    reply.header('set-cookie', sessionCookie(session.id));
    return ok({ csrf_token: session.csrf });
  });
  app.delete('/api/v1/session', async (request, reply) => {
    if (request.body !== undefined) objectBody(request.body, []);
    const id = auth.authenticate(request.headers.cookie, request.headers['x-csrf-token'] as string, true);
    auth.logout(id);
    reply.header('set-cookie', sessionCookie('', true));
    return ok({ logged_out: true });
  });
  app.get('/api/v1/connections', async request => {
    objectBody(request.query, []);
    return ok({ items: await connections.list(), next_cursor: null });
  });
  app.post('/api/v1/connections', async (request, reply) => {
    const data = await connections.create(request.body);
    reply.code(201);
    return ok(data);
  });
  app.patch<{ Params: { connection_id: string } }>('/api/v1/connections/:connection_id', async request =>
    ok(await connections.update(request.params.connection_id, request.body)));
  app.delete<{ Params: { connection_id: string } }>('/api/v1/connections/:connection_id', async request =>
    ok(await connections.remove(request.params.connection_id, request.body)));
  app.post('/api/v1/connections/test', async request => ok(await connections.testDraft(request.body)));
  app.post<{ Params: { connection_id: string } }>('/api/v1/connections/:connection_id/test', async request =>
    ok(await connections.testSaved(request.params.connection_id, request.body)));
}
