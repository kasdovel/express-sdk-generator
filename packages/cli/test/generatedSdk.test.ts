/**
 * Behavioural tests for the generated SDK: `emitSdk` writes a client into a temp
 * directory, the test imports it and drives it through a fake Transport. This is
 * the cheapest place to assert what the emitted runtime actually *does*, without
 * standing up the example app.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { emitSdk } from '../src/emitSdk.js';
import type { SdkConfig } from '../src/config.js';

interface TransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}
interface TransportResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}
interface ApiResponse<T> {
  status: number;
  headers: Record<string, string>;
  data: T;
}
type Transport = (req: TransportRequest) => Promise<TransportResponse>;

interface GeneratedSdk {
  ApiClient: new (options?: {
    baseUrl?: string;
    transport?: Transport;
  }) => Record<string, (...args: unknown[]) => Promise<unknown>>;
  ApiError: new (status: number, body: unknown) => Error;
  isApiError: ((err: unknown) => boolean) & ((err: unknown, status: number) => boolean);
}

const USER = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id', 'name'],
};
const ERROR_BODY = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};
const json = (schema: unknown) => ({
  description: 'x',
  content: { 'application/json': { schema } },
});

const DOC = {
  openapi: '3.1.0',
  info: { title: 'T', version: '1' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: json({ type: 'array', items: USER }) },
      },
      post: {
        operationId: 'createUser',
        requestBody: { required: true, content: { 'application/json': { schema: USER } } },
        responses: { 201: json(USER) },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: json(USER), 404: json(ERROR_BODY) },
      },
      head: {
        operationId: 'headUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: json(USER) },
      },
    },
  },
};

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * Generate an SDK and import it. The directory lives under `test/` (dot-prefixed
 * so vitest ignores it) because vitest only transforms TypeScript inside the
 * project root.
 */
async function buildSdk(
  sdk: Partial<SdkConfig> = {},
  document: object = DOC,
): Promise<GeneratedSdk> {
  const dir = await mkdtemp(join(import.meta.dirname, '.generated-'));
  dirs.push(dir);
  const outDir = await emitSdk(document, { out: 'sdk', ...sdk }, dir);
  return (await import(join(outDir, 'index.ts'))) as GeneratedSdk;
}

const ok =
  (data: unknown, headers?: Record<string, string>, status = 200): Transport =>
  () =>
    Promise.resolve({ status, data, headers });

const USER_ROW = { id: '1', name: 'Ada' };

describe('status and headers on success', () => {
  it('returns { status, headers, data } from the …WithResponse sibling', async () => {
    const { ApiClient } = await buildSdk();
    const client = new ApiClient({
      transport: ok([USER_ROW], { ETag: 'W/"abc"', 'X-Total-Count': '42' }),
    });

    const res = (await client.listUsersWithResponse!()) as ApiResponse<unknown>;
    expect(res.status).toBe(200);
    expect(res.data).toEqual([USER_ROW]);
    // Header names are lower-cased, so a consumer can read them by one spelling.
    expect(res.headers).toEqual({ etag: 'W/"abc"', 'x-total-count': '42' });
  });

  it('keeps the plain method returning only the parsed body', async () => {
    const { ApiClient } = await buildSdk();
    const client = new ApiClient({ transport: ok([USER_ROW], { etag: 'x' }) });
    expect(await client.listUsers!()).toEqual([USER_ROW]);
  });

  it('reports {} for a Transport that does not supply headers', async () => {
    // TransportResponse.headers is optional, so Transports written before this
    // feature keep compiling and working.
    const { ApiClient } = await buildSdk();
    const client = new ApiClient({ transport: async () => ({ status: 200, data: [USER_ROW] }) });

    const res = (await client.listUsersWithResponse!()) as ApiResponse<unknown>;
    expect(res.headers).toEqual({});
    expect(res.data).toEqual([USER_ROW]);
  });

  it('populates the headers from a real response via the built-in fetch transport', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('ETag', 'W/"live"');
      res.end(JSON.stringify([USER_ROW]));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const { ApiClient } = await buildSdk();
    const client = new ApiClient({ baseUrl: `http://localhost:${port}` });
    const res = (await client.listUsersWithResponse!()) as ApiResponse<unknown>;

    expect(res.headers.etag).toBe('W/"live"');
    server.close();
  });

  it('still validates the response and maps the status on the …WithResponse path', async () => {
    const { ApiClient, ApiError } = await buildSdk();
    const drifted = new ApiClient({ transport: ok({ not: 'an array' }) });
    await expect(drifted.listUsersWithResponse!()).rejects.toBeInstanceOf(ZodError);

    const failing = new ApiClient({ transport: ok({ error: 'nope' }, {}, 503) });
    await expect(failing.listUsersWithResponse!()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('typed error responses', () => {
  it('keeps ApiError throwable with its status and body', async () => {
    const { ApiClient, ApiError } = await buildSdk();
    const client = new ApiClient({ transport: ok({ error: 'User not found' }, {}, 404) });

    await expect(client.getUser!({ params: { id: '1' } })).rejects.toMatchObject({
      status: 404,
      body: { error: 'User not found' },
    });
    await expect(client.getUser!({ params: { id: '1' } })).rejects.toBeInstanceOf(ApiError);
  });

  it('narrows with isApiError, by status or not at all', async () => {
    const { ApiClient, isApiError } = await buildSdk();
    const client = new ApiClient({ transport: ok({ error: 'gone' }, {}, 404) });

    const err = await client.getUser!({ params: { id: '1' } }).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(isApiError(err, 404)).toBe(true);
    expect(isApiError(err, 500)).toBe(false);
    expect(isApiError(new Error('boom'))).toBe(false);
    expect(isApiError(undefined, 404)).toBe(false);
  });
});

describe('HEAD routes', () => {
  it('does not parse a response body for HEAD, even if one arrives', async () => {
    const { ApiClient } = await buildSdk();
    // A declared 200 schema plus a stray body would fail validation on any other
    // method; HEAD carries no body by definition, so nothing is parsed.
    const client = new ApiClient({ transport: ok('<html>surprise</html>', { etag: 'x' }) });

    expect(await client.headUser!({ params: { id: '1' } })).toBeUndefined();
    const res = (await client.headUserWithResponse!({
      params: { id: '1' },
    })) as ApiResponse<unknown>;
    expect(res.data).toBeUndefined();
    expect(res.headers.etag).toBe('x');
  });
});

describe('sdk.validateRequests', () => {
  it('sends whatever it is given when the option is off', async () => {
    const { ApiClient } = await buildSdk();
    let seen: unknown;
    const client = new ApiClient({
      transport: async (req) => {
        seen = req.body;
        return { status: 201, data: USER_ROW };
      },
    });

    await client.createUser!({ body: { id: '1' } as never });
    expect(seen).toEqual({ id: '1' });
  });

  it('fails locally with a ZodError before the request leaves', async () => {
    const { ApiClient } = await buildSdk({ validateRequests: true });
    let called = false;
    const client = new ApiClient({
      transport: async () => {
        called = true;
        return { status: 201, data: USER_ROW };
      },
    });

    await expect(client.createUser!({ body: { id: '1' } as never })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(called).toBe(false);
  });

  it('applies the defaults declared in the route schemas client-side', async () => {
    const { ApiClient } = await buildSdk({ validateRequests: true });
    let url = '';
    const client = new ApiClient({
      baseUrl: 'http://x.invalid',
      transport: async (req) => {
        url = req.url;
        return { status: 200, data: [] };
      },
    });

    await client.listUsers!();
    expect(url).toBe('http://x.invalid/users?limit=20');
  });

  it('strips keys the schema does not declare instead of sending them', async () => {
    const { ApiClient } = await buildSdk({ validateRequests: true });
    let seen: unknown;
    const client = new ApiClient({
      transport: async (req) => {
        seen = req.body;
        return { status: 201, data: USER_ROW };
      },
    });

    await client.createUser!({ body: { ...USER_ROW, extra: true } as never });
    expect(seen).toEqual(USER_ROW);
  });
});

describe('recursive schemas', () => {
  const RECURSIVE = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    components: {
      schemas: {
        Category: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
          },
          required: ['name'],
        },
      },
    },
    paths: {
      '/categories': {
        get: {
          operationId: 'getCategory',
          responses: { 200: json({ $ref: '#/components/schemas/Category' }) },
        },
      },
    },
  };

  it('validates a self-referential response instead of accepting anything', async () => {
    const { ApiClient } = await buildSdk({}, RECURSIVE);
    const tree = { name: 'root', children: [{ name: 'leaf', children: [] }] };

    const good = new ApiClient({ transport: ok(tree) });
    expect(await good.getCategory!()).toEqual(tree);

    // The old `z.any()` fallback accepted this silently.
    const bad = new ApiClient({ transport: ok({ name: 'root', children: [{ nope: 1 }] }) });
    await expect(bad.getCategory!()).rejects.toBeInstanceOf(ZodError);
  });
});
