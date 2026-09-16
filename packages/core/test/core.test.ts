import { describe, it, expect } from 'vitest';
import express from 'express';
import { z } from 'zod';
import {
  createRoute,
  createRegistry,
  buildDocument,
  validateRequest,
  router as apiRouter,
  serveDocs,
} from '../src/index.js';
import type { Server } from 'node:http';

describe('createRoute + registry', () => {
  it('records the operation into the registry', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'get',
      path: '/things/:id',
      operationId: 'getThing',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: (_req, res) => {
        res.json({ id: '1' });
      },
    });
    expect(registry.routes).toHaveLength(1);
    expect(registry.routes[0]!.operationId).toBe('getThing');
  });

  it('rejects an operationId that is not a valid JS identifier', () => {
    const registry = createRegistry();
    const router = express.Router();
    expect(() =>
      createRoute(router, {
        method: 'get',
        path: '/a',
        operationId: 'get-user',
        responses: { 200: z.string() },
        registry,
        handler: (_req, res) => {
          res.json(1);
        },
      }),
    ).toThrow(/Invalid operationId/);
  });

  it('rejects two operations on the same method + path', () => {
    const registry = createRegistry();
    const router = express.Router();
    const def = {
      method: 'get' as const,
      path: '/things',
      responses: { 200: z.string() },
      registry,
      handler: (_req: unknown, res: { json: (v: unknown) => void }) => res.json(1),
    };
    createRoute(router, { ...def, operationId: 'listThings' });
    expect(() => createRoute(router, { ...def, operationId: 'alsoListThings' })).toThrow(
      /Duplicate route GET \/things/,
    );
  });

  it('rejects a path parameter that request.params does not declare', () => {
    const registry = createRegistry();
    const router = express.Router();
    const handler = (_req: unknown, res: { json: (v: unknown) => void }) => res.json(1);

    expect(() =>
      createRoute(router, {
        method: 'get',
        path: '/things/:id',
        operationId: 'getThingNoParams',
        responses: { 200: z.string() },
        registry,
        handler,
      }),
    ).toThrow(/no "request.params" schema/);

    expect(() =>
      createRoute(router, {
        method: 'get',
        path: '/things/:id/parts/:partId',
        operationId: 'getPart',
        request: { params: z.object({ id: z.string() }) },
        responses: { 200: z.string() },
        registry,
        handler,
      }),
    ).toThrow(/":partId"/);
  });

  it('rejects duplicate operationIds', () => {
    const registry = createRegistry();
    const router = express.Router();
    const def = {
      method: 'get' as const,
      path: '/a',
      operationId: 'dup',
      responses: { 200: z.string() },
      registry,
      handler: (_req: unknown, res: { json: (v: unknown) => void }) => res.json(1),
    };
    createRoute(router, def);
    expect(() => createRoute(router, { ...def, path: '/b' })).toThrow(/Duplicate operationId/);
  });
});

describe('buildDocument', () => {
  it('produces a 3.1 document with the registered path', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'post',
      path: '/users/:id',
      operationId: 'updateUser',
      request: {
        params: z.object({ id: z.string() }),
        body: z.object({ name: z.string() }),
      },
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: (_req, res) => {
        res.json({ id: '1' });
      },
    });

    const doc = buildDocument(registry, { title: 'T', version: '1.0.0' }) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/users/{id}']!.post).toBeDefined();
  });
});

describe('router (prefix-aware)', () => {
  it('records fully-qualified paths for nested routers', () => {
    const registry = createRegistry();
    const accounts = apiRouter('/accounts', { registry });
    accounts.route({
      method: 'get',
      path: '/',
      operationId: 'listAccounts',
      responses: { 200: z.array(z.string()) },
      handler: (_req, res) => {
        res.json([]);
      },
    });
    const admins = accounts.router('/admins');
    admins.route({
      method: 'get',
      path: '/:id',
      operationId: 'getAccountAdmin',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: z.string() },
      handler: (_req, res) => {
        res.json('ok');
      },
    });

    const paths = registry.routes.map((r) => r.path);
    expect(paths).toEqual(['/accounts', '/accounts/admins/:id']);
  });
});

describe('validateRequest', () => {
  it('400s on invalid body and places parsed data on req.valid otherwise', () => {
    const mw = validateRequest({ body: z.object({ n: z.coerce.number() }) });

    // Failure path
    let status = 0;
    const failReq = { body: { n: 'not-a-number' } } as never;
    mw(
      failReq,
      {
        status: (s: number) => ({
          json: () => {
            status = s;
          },
        }),
      } as never,
      () => {},
    );
    expect(status).toBe(400);

    // Success path: coercion applied, attached to req.valid
    const okReq = {
      body: { n: '42' },
      params: {},
      query: {},
      headers: {},
    } as Record<string, unknown>;
    let nexted = false;
    mw(okReq as never, {} as never, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect((okReq.valid as { body: { n: number } }).body.n).toBe(42);
  });
});

describe('serveDocs', () => {
  it('serves routes registered after it was mounted', async () => {
    const registry = createRegistry();
    const app = express();
    await serveDocs(app, { registry, title: 'Live', version: '1.0.0' });

    // Registered *after* serveDocs — a router mounted later in the file, say.
    createRoute(app, {
      method: 'get',
      path: '/late',
      operationId: 'late',
      responses: { 200: z.string() },
      registry,
      handler: (_req, res) => {
        res.json('ok');
      },
    });

    let server: Server | undefined;
    try {
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const spec = (await (await fetch(`http://localhost:${port}/docs.json`)).json()) as {
        paths: Record<string, unknown>;
      };
      expect(Object.keys(spec.paths)).toContain('/late');

      const ui = await fetch(`http://localhost:${port}/docs/`);
      expect(ui.status).toBe(200);
      expect(await ui.text()).toContain('swagger-ui');
    } finally {
      server?.close();
    }
  });
});
