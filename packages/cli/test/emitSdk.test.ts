import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitSdk } from '../src/emitSdk.js';
import type { SdkConfig } from '../src/config.js';

const USER = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
  },
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
  components: { schemas: {} },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: json({ type: 'array', items: USER }), 500: json(ERROR_BODY) },
      },
      post: {
        operationId: 'createUser',
        requestBody: { required: true, content: { 'application/json': { schema: USER } } },
        responses: { 201: json(USER), 400: json(ERROR_BODY) },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: json(USER), 404: json(ERROR_BODY), '4XX': json(ERROR_BODY) },
      },
      head: {
        operationId: 'headUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: json(USER) },
      },
    },
  },
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdkgen-emit-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let seq = 0;
async function generate(
  sdk: Partial<SdkConfig> = {},
  document: object = DOC,
): Promise<Record<string, string>> {
  const out = `sdk-${seq++}`;
  const outDir = await emitSdk(document, { out, ...sdk }, dir);
  const names = ['schemas.ts', 'types.ts', 'client.ts', 'runtime.ts', 'index.ts'];
  const files = await Promise.all(names.map((n) => readFile(join(outDir, n), 'utf8')));
  return Object.fromEntries(names.map((n, i) => [n, files[i]!]));
}

describe('declared error responses', () => {
  it('emits a schema and a type for every declared non-2xx response', async () => {
    const files = await generate();
    expect(files['schemas.ts']).toContain('export const getUserError404 =');
    expect(files['schemas.ts']).toContain('export const createUserError400 =');
    expect(files['schemas.ts']).toContain('export const listUsersError500 =');
    expect(files['types.ts']).toContain(
      'export type GetUserError404 = z.infer<typeof s.getUserError404>;',
    );
  });

  it('skips wildcard and default response keys, which have no single status', async () => {
    const files = await generate();
    expect(files['schemas.ts']).not.toContain('Error4XX');
    expect(files['client.ts']).not.toContain('4XX');
  });

  it('augments ApiErrorBodies so isApiError(err, status) can narrow the body', async () => {
    const client = (await generate())['client.ts']!;
    expect(client).toContain("declare module './runtime.js' {");
    expect(client).toContain('interface ApiErrorBodies {');
    expect(client).toContain('400: t.CreateUserError400;');
    expect(client).toContain('404: t.GetUserError404;');
    expect(client).toContain('500: t.ListUsersError500;');
  });

  it('unions the declared bodies when two routes disagree about a status', async () => {
    const doc = structuredClone(DOC) as typeof DOC;
    doc.paths['/users'].post.responses[400] = json({
      type: 'object',
      properties: { fields: { type: 'array', items: { type: 'string' } } },
      required: ['fields'],
    });
    doc.paths['/users'].get.responses[500] = json(ERROR_BODY);
    doc.paths['/users/{id}'].get.responses[400] = json(ERROR_BODY);

    const client = (await generate({}, doc))['client.ts']!;
    expect(client).toContain('400: t.CreateUserError400 | t.GetUserError400;');
  });

  it('emits no augmentation when the API declares no error bodies', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: { '/ping': { get: { operationId: 'ping', responses: { 200: json(USER) } } } },
    };
    const client = (await generate({}, doc))['client.ts']!;
    expect(client).not.toContain('ApiErrorBodies');
  });
});

describe('status and headers on success', () => {
  it('emits a …WithResponse sibling for every operation', async () => {
    const client = (await generate())['client.ts']!;
    for (const id of ['listUsers', 'createUser', 'getUser', 'headUser']) {
      expect(client).toContain(`${id}(`);
      expect(client).toContain(`${id}WithResponse(`);
    }
  });

  it('routes the sibling through requestWithResponse and keeps the plain method as-is', async () => {
    const client = (await generate())['client.ts']!;
    expect(client).toContain(
      'getUser(args: { params: t.GetUserParams }, options?: RequestOptions) {\n' +
        "    return this.request('GET', '/users/{id}', args, s.getUserResponse, options);",
    );
    expect(client).toContain(
      'getUserWithResponse(args: { params: t.GetUserParams }, options?: RequestOptions) {\n' +
        "    return this.requestWithResponse('GET', '/users/{id}', args, s.getUserResponse, options);",
    );
  });

  it('rejects an operationId that would collide with a generated sibling', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/a': { get: { operationId: 'thing', responses: { 200: json(USER) } } },
        '/b': { get: { operationId: 'thingWithResponse', responses: { 200: json(USER) } } },
      },
    };
    await expect(generate({}, doc)).rejects.toThrow(/thingWithResponse/);
  });

  it('still rejects an operationId that shadows a BaseClient member', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: { '/a': { get: { operationId: 'request', responses: { 200: json(USER) } } } },
    };
    await expect(generate({}, doc)).rejects.toThrow(/BaseClient/);
  });
});

describe('sdk.validateRequests', () => {
  it('passes arguments straight through by default', async () => {
    const client = (await generate())['client.ts']!;
    expect(client).toContain("this.request('POST', '/users', args, s.createUserResponse");
    expect(client).not.toContain('.parse(args.');
  });

  it('parses params, query and body through the operation schemas when enabled', async () => {
    const client = (await generate({ validateRequests: true }))['client.ts']!;
    expect(client).toContain('params: s.getUserParams.parse(args.params)');
    expect(client).toContain('query: s.listUsersQuery.parse(args.query ?? {})');
    expect(client).toContain('body: s.createUserBody.parse(args.body)');
  });

  it('makes a validating method async, so a bad call rejects instead of throwing', async () => {
    const client = (await generate({ validateRequests: true }))['client.ts']!;
    expect(client).toContain('async getUser(args: { params: t.GetUserParams }');
    expect(client).toContain('async getUserWithResponse(args: { params: t.GetUserParams }');
  });

  it('leaves an optional body undefined rather than parsing it', async () => {
    const doc = structuredClone(DOC) as typeof DOC;
    doc.paths['/users'].post.requestBody.required = false;
    const client = (await generate({ validateRequests: true }, doc))['client.ts']!;
    expect(client).toContain(
      'body: args.body === undefined ? undefined : s.createUserBody.parse(args.body)',
    );
  });
});

describe('HEAD routes', () => {
  it('drops a declared HEAD response body and says why', async () => {
    const files = await generate();
    expect(files['schemas.ts']).toContain('export const headUserResponse = z.void();');
    expect(files['schemas.ts']).toContain('sdkgen: HEAD carries no response body');
    expect(files['schemas.ts']).toContain('headUserWithResponse()');
  });
});

describe('named and deduplicated schemas', () => {
  it('emits one shared const for a shape that repeats, and reuses it', async () => {
    const schemas = (await generate())['schemas.ts']!;
    // The `User` shape is declared by four operations; only one copy is emitted.
    const objects = schemas.match(/z\.object\(\{\n {2}id: z\.string\(\)\.uuid\(\),/g) ?? [];
    expect(objects).toHaveLength(1);
    expect(schemas).toMatch(/export const getUserResponse = Shared[0-9a-f]{8};/);
    expect(schemas).toMatch(/export const createUserResponse = Shared[0-9a-f]{8};/);
  });

  it('uses the component name when the document has a $ref', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      components: { schemas: { User: USER } },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              200: json({ type: 'array', items: { $ref: '#/components/schemas/User' } }),
            },
          },
        },
      },
    };
    const files = await generate({}, doc);
    expect(files['schemas.ts']).toContain('export const User = z.object({');
    expect(files['schemas.ts']).toContain('export const listUsersResponse = z.array(User);');
    // A component name is meaningful, so it is re-exported as a type.
    expect(files['types.ts']).toContain('export type User = z.infer<typeof s.User>;');
  });

  it('never lets a shared name collide with a per-operation export', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      components: { schemas: { getUserResponse: USER } },
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: json({ $ref: '#/components/schemas/getUserResponse' }) },
          },
        },
      },
    };
    const schemas = (await generate({}, doc))['schemas.ts']!;
    expect(schemas).toContain('export const getUserResponse_2 = z.object({');
    expect(schemas).toContain('export const getUserResponse = getUserResponse_2;');
  });

  it('produces byte-identical output on a second run', async () => {
    const [a, b] = await Promise.all([generate(), generate()]);
    expect(a).toEqual(b);
  });
});

describe('generated formatting', () => {
  it('indents every generated file in consistent two-space steps', async () => {
    const files = await generate({ validateRequests: true });
    for (const [name, source] of Object.entries(files)) {
      if (name === 'runtime.ts') continue; // copied verbatim from a reviewed template
      for (const line of source.split('\n')) {
        if (!line.trim()) continue;
        expect(
          /^(?: {2})*\S/.test(line),
          `${name} has a line that is not indented in two-space steps: ${JSON.stringify(line)}`,
        ).toBe(true);
      }
    }
  });

  it('leaves no trailing whitespace and ends with a newline', async () => {
    const files = await generate();
    for (const [name, source] of Object.entries(files)) {
      expect(source, `${name} has trailing whitespace`).not.toMatch(/[ \t]+\n/);
      expect(source.endsWith('\n'), `${name} does not end with a newline`).toBe(true);
    }
  });

  it('surfaces an unsupported keyword as a comment above the const it affects', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            responses: {
              200: json({
                type: 'object',
                properties: { host: { type: 'string', format: 'hostname' } },
              }),
            },
          },
        },
      },
    };
    const schemas = (await generate({}, doc))['schemas.ts']!;
    expect(schemas).toContain(
      '// sdkgen: unsupported format "hostname" at #/properties/host — the value is validated as a plain string\nexport const listThingsResponse =',
    );
  });
});
