import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Express } from 'express';
import type { Server } from 'node:http';
import { z } from 'zod';
import {
  createRoute,
  createRegistry,
  ResponseValidationError,
  UndeclaredResponseError,
} from '../src/index.js';

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** Boot `app` on an ephemeral port and return its base URL. */
async function serve(app: Express): Promise<string> {
  const server = await new Promise<Server>((done) => {
    const s = app.listen(0, () => done(s));
  });
  servers.push(server);
  const addr = server.address();
  return `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

// `registerRoute` funnels handler throws into `next(err)`, so drift surfaces at
// the app's error handler — which is exactly how it shows up in an API's own
// test suite, and why these tests install one.

describe('res.valid', () => {
  it('sends the payload when it matches the declared schema', async () => {
    const registry = createRegistry();
    const app = express();
    createRoute(app, {
      method: 'get',
      path: '/thing',
      operationId: 'getThing',
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: (_req, res) => {
        res.valid(200, { id: 'abc' });
      },
    });

    const base = await serve(app);
    const res = await fetch(`${base}/thing`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'abc' });
  });

  it('sends the parsed value, so schema defaults reach the wire', async () => {
    const registry = createRegistry();
    const app = express();
    createRoute(app, {
      method: 'get',
      path: '/defaulted',
      operationId: 'getDefaulted',
      responses: { 200: z.object({ id: z.string(), role: z.string().default('user') }) },
      registry,
      handler: (_req, res) => {
        res.valid(200, { id: 'abc' });
      },
    });

    const base = await serve(app);
    expect(await (await fetch(`${base}/defaulted`)).json()).toEqual({ id: 'abc', role: 'user' });
  });

  it('throws ResponseValidationError when the payload drifts from the schema', async () => {
    const registry = createRegistry();
    const app = express();
    let caught: unknown;
    createRoute(app, {
      method: 'get',
      path: '/drifted',
      operationId: 'getDrifted',
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: (_req, res) => {
        // The handler grew a field rename; the spec and SDK still promise `id`.
        res.valid(200, { identifier: 'abc' } as never);
      },
    });
    app.use(((err, _req, res, _next) => {
      caught = err;
      res.status(500).end();
    }) as express.ErrorRequestHandler);

    const base = await serve(app);
    expect((await fetch(`${base}/drifted`)).status).toBe(500);
    expect(caught).toBeInstanceOf(ResponseValidationError);
    const err = caught as ResponseValidationError;
    expect(err.operationId).toBe('getDrifted');
    expect(err.status).toBe(200);
    expect(err.issues.length).toBeGreaterThan(0);
    expect(err.message).toContain('getDrifted');
  });

  it('throws UndeclaredResponseError for a status the route never declared', async () => {
    const registry = createRegistry();
    const app = express();
    let caught: unknown;
    createRoute(app, {
      method: 'get',
      path: '/undeclared',
      operationId: 'getUndeclared',
      responses: { 200: z.string() },
      registry,
      handler: (_req, res) => {
        (res.valid as (status: number, payload: unknown) => unknown)(418, { nope: true });
      },
    });
    app.use(((err, _req, res, _next) => {
      caught = err;
      res.status(500).end();
    }) as express.ErrorRequestHandler);

    const base = await serve(app);
    expect((await fetch(`${base}/undeclared`)).status).toBe(500);
    expect(caught).toBeInstanceOf(UndeclaredResponseError);
    expect((caught as UndeclaredResponseError).status).toBe(418);
    expect((caught as Error).message).toContain('declares no 418 response');
  });

  it('sends no body for 204, 205 and 304', async () => {
    const registry = createRegistry();
    const app = express();
    for (const status of [204, 205, 304] as const) {
      createRoute(app, {
        method: 'get',
        path: `/empty/${status}`,
        operationId: `getEmpty${status}`,
        responses: { [status]: z.undefined() },
        registry,
        handler: (_req, res) => {
          res.valid(status, undefined);
        },
      });
    }

    const base = await serve(app);
    for (const status of [204, 205, 304]) {
      const res = await fetch(`${base}/empty/${status}`);
      expect(res.status).toBe(status);
      expect(await res.text()).toBe('');
    }
  });

  it('leaves res.json untouched — drift through it still ships', async () => {
    const registry = createRegistry();
    const app = express();
    createRoute(app, {
      method: 'get',
      path: '/raw',
      operationId: 'getRaw',
      responses: { 200: z.object({ id: z.string() }) },
      registry,
      handler: (_req, res) => {
        res.json({ anything: 'goes' });
      },
    });

    const base = await serve(app);
    const res = await fetch(`${base}/raw`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ anything: 'goes' });
  });
});

describe('res.valid validation toggle', () => {
  const withNodeEnv = async (value: string | undefined, fn: () => Promise<void>): Promise<void> => {
    const previous = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    try {
      await fn();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  };

  /** A route whose handler always sends a payload the schema rejects. */
  async function driftingApp(validateResponses?: boolean): Promise<string> {
    const registry = createRegistry();
    const app = express();
    createRoute(app, {
      method: 'get',
      path: '/drift',
      operationId: 'getDrift',
      responses: { 200: z.object({ id: z.string() }) },
      validateResponses,
      registry,
      handler: (_req, res) => {
        res.valid(200, { id: 1 } as never);
      },
    });
    app.use(((_err, _req, res, _next) => {
      res.status(500).end();
    }) as express.ErrorRequestHandler);
    return serve(app);
  }

  it('is off in production, so the drifted payload ships', async () => {
    await withNodeEnv('production', async () => {
      const base = await driftingApp();
      const res = await fetch(`${base}/drift`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 1 });
    });
  });

  it('is on outside production', async () => {
    await withNodeEnv('test', async () => {
      const base = await driftingApp();
      expect((await fetch(`${base}/drift`)).status).toBe(500);
    });
  });

  it('honours an explicit override in either direction', async () => {
    await withNodeEnv('production', async () => {
      const base = await driftingApp(true);
      expect((await fetch(`${base}/drift`)).status).toBe(500);
    });
    await withNodeEnv('test', async () => {
      const base = await driftingApp(false);
      expect((await fetch(`${base}/drift`)).status).toBe(200);
    });
  });

  it('reads NODE_ENV per response, not at registration time', async () => {
    // A route registered before the env is configured must still respect it.
    let base = '';
    await withNodeEnv('production', async () => {
      base = await driftingApp();
    });
    await withNodeEnv('test', async () => {
      expect((await fetch(`${base}/drift`)).status).toBe(500);
    });
  });
});
