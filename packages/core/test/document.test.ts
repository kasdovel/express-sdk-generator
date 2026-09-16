import { describe, it, expect } from 'vitest';
import express from 'express';
import { z } from 'zod';
import {
  createRoute,
  createRegistry,
  buildDocument,
  ValidationErrorSchema,
  validationErrorBody,
} from '../src/index.js';
import type { Registry } from '../src/index.js';
import type { Server } from 'node:http';

interface Doc {
  paths: Record<string, Record<string, Operation>>;
  components?: {
    schemas?: Record<string, Record<string, unknown>>;
    securitySchemes?: Record<string, Record<string, unknown>>;
  };
  security?: Record<string, string[]>[];
}

interface Operation {
  responses: Record<
    string,
    { description?: string; content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
  security?: Record<string, string[]>[];
}

const noop = (_req: unknown, res: { json: (v: unknown) => void }): void => res.json(null);

function build(registry: Registry, info: Partial<Parameters<typeof buildDocument>[1]> = {}): Doc {
  return buildDocument(registry, { title: 'T', version: '1.0.0', ...info }) as unknown as Doc;
}

describe('validation 400 in the document', () => {
  it('adds a 400 referencing the shared component to every route with request schemas', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'get',
      path: '/things/:id',
      operationId: 'getThing',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: noop,
    });

    const doc = build(registry);
    const op = doc.paths['/things/{id}']!.get!;
    expect(op.responses['400']).toBeDefined();
    expect(op.responses['400']!.content!['application/json']!.schema).toEqual({
      $ref: '#/components/schemas/ValidationError',
    });
    // Shared, not inlined per operation.
    expect(doc.components?.schemas?.ValidationError).toBeDefined();
  });

  it('leaves routes without request schemas alone', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'get',
      path: '/health',
      operationId: 'health',
      responses: { 200: z.object({ ok: z.boolean() }) },
      registry,
      handler: noop,
    });

    const doc = build(registry);
    expect(doc.paths['/health']!.get!.responses['400']).toBeUndefined();
    // Nothing references it, so the component is not emitted either.
    expect(doc.components?.schemas?.ValidationError).toBeUndefined();
  });

  it('never overwrites a 400 the route declares itself', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'post',
      path: '/things',
      operationId: 'createThing',
      request: { body: z.object({ name: z.string() }) },
      responses: {
        201: z.object({ id: z.string() }),
        400: { schema: z.object({ mine: z.string() }), description: 'My own envelope' },
      },
      registry,
      handler: noop,
    });

    const op = build(registry).paths['/things']!.post!;
    expect(op.responses['400']!.description).toBe('My own envelope');
    expect(op.responses['400']!.content!['application/json']!.schema).toMatchObject({
      properties: { mine: { type: 'string' } },
    });
  });

  it('is opt-out via validationErrors: false', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'get',
      path: '/things',
      operationId: 'listThings',
      request: { query: z.object({ limit: z.coerce.number().optional() }) },
      responses: { 200: z.array(z.string()) },
      registry,
      handler: noop,
    });

    const doc = build(registry, { validationErrors: false });
    expect(doc.paths['/things']!.get!.responses['400']).toBeUndefined();
    expect(doc.components?.schemas?.ValidationError).toBeUndefined();
  });

  it('documents the shape the middleware actually sends', async () => {
    // The point of the whole exercise: the component in the spec and the body on
    // the wire come from one schema, so this asserts the real 400 parses.
    const registry = createRegistry();
    const app = express();
    app.use(express.json());
    createRoute(app, {
      method: 'post',
      path: '/things',
      operationId: 'createThing',
      request: { body: z.object({ name: z.string() }) },
      responses: { 201: z.object({ id: z.string() }) },
      registry,
      handler: noop,
    });

    const server = await new Promise<Server>((done) => {
      const s = app.listen(0, () => done(s));
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const res = await fetch(`http://localhost:${port}/things`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 42 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(() => ValidationErrorSchema.parse(body)).not.toThrow();
    } finally {
      server.close();
    }
  });

  it('builds its body from the exported schema', () => {
    const body = validationErrorBody({
      part: 'query',
      issues: z.string().safeParse(1).error!.issues,
    });
    expect(ValidationErrorSchema.parse(body)).toMatchObject({
      error: 'ValidationError',
      part: 'query',
    });
  });
});

describe('security', () => {
  it('emits securitySchemes, a document-wide default, and per-operation overrides', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'get',
      path: '/me',
      operationId: 'getMe',
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: noop,
    });
    createRoute(router, {
      method: 'post',
      path: '/login',
      operationId: 'login',
      // Explicitly public: overrides the document-wide default.
      security: [],
      responses: { 200: z.object({ token: z.string() }) },
      registry,
      handler: noop,
    });
    createRoute(router, {
      method: 'get',
      path: '/admin',
      operationId: 'getAdmin',
      security: [{ apiKey: [] }],
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: noop,
    });

    const doc = build(registry, {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
      security: [{ bearerAuth: [] }],
    });

    expect(doc.components?.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    // No per-operation security: inherits the document default.
    expect(doc.paths['/me']!.get!.security).toBeUndefined();
    expect(doc.paths['/login']!.post!.security).toEqual([]);
    expect(doc.paths['/admin']!.get!.security).toEqual([{ apiKey: [] }]);
  });

  it('records security on the route definition', () => {
    const registry = createRegistry();
    createRoute(express.Router(), {
      method: 'get',
      path: '/secret',
      operationId: 'getSecret',
      security: [{ bearerAuth: ['read:secrets'] }],
      responses: { 200: z.string() },
      registry,
      handler: noop,
    });
    expect(registry.routes[0]!.security).toEqual([{ bearerAuth: ['read:secrets'] }]);
  });

  it('emits no securitySchemes when none are declared', () => {
    const registry = createRegistry();
    createRoute(express.Router(), {
      method: 'get',
      path: '/open',
      operationId: 'getOpen',
      responses: { 200: z.string() },
      registry,
      handler: noop,
    });
    const doc = build(registry);
    expect(doc.components?.securitySchemes).toBeUndefined();
    expect(doc.security).toBeUndefined();
  });
});

describe('bodyless statuses', () => {
  it('omits content for 204, 205 and 304 but keeps it for 200', () => {
    const registry = createRegistry();
    const router = express.Router();
    createRoute(router, {
      method: 'get',
      path: '/resource',
      operationId: 'getResource',
      responses: {
        200: z.object({ id: z.string() }),
        304: z.undefined(),
      },
      registry,
      handler: noop,
    });
    createRoute(router, {
      method: 'delete',
      path: '/resource',
      operationId: 'deleteResource',
      responses: { 204: z.undefined(), 205: z.undefined() },
      registry,
      handler: noop,
    });

    const doc = build(registry);
    const get = doc.paths['/resource']!.get!;
    expect(get.responses['200']!.content).toBeDefined();
    expect(get.responses['304']!.content).toBeUndefined();
    expect(get.responses['304']!.description).toBe('Not Modified');

    const del = doc.paths['/resource']!.delete!;
    expect(del.responses['204']!.content).toBeUndefined();
    expect(del.responses['205']!.content).toBeUndefined();
    expect(del.responses['205']!.description).toBe('Reset Content');
  });
});
