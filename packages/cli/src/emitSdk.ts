import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SdkConfig } from './config.js';
import { toZod, type JsonSchema, type SchemaContext } from './jsonSchemaToZod.js';
import { RUNTIME_SOURCE } from './sdkRuntime.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

interface Param {
  name: string;
  required: boolean;
  schema: JsonSchema;
}

interface Operation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  pathParams: Param[];
  queryParams: Param[];
  bodySchema?: JsonSchema;
  bodyRequired: boolean;
  responseSchema?: JsonSchema;
}

interface OADoc {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function collectOperations(doc: OADoc): Operation[] {
  const ops: Operation[] = [];
  const paths = doc.paths ?? {};
  for (const [path, item] of Object.entries(paths)) {
    const pathParams = ((item as { parameters?: unknown[] }).parameters ??
      []) as Record<string, unknown>[];
    for (const method of HTTP_METHODS) {
      const op = item[method] as Record<string, unknown> | undefined;
      if (!op) continue;

      const allParams = [
        ...pathParams,
        ...(((op.parameters as Record<string, unknown>[]) ?? [])),
      ];
      const toParam = (p: Record<string, unknown>): Param => ({
        name: String(p.name),
        required: Boolean(p.required),
        schema: (p.schema as JsonSchema) ?? {},
      });

      const body = (op.requestBody as Record<string, unknown>) ?? undefined;
      const bodySchema = body
        ? ((body.content as Record<string, { schema?: JsonSchema }>)?.[
            'application/json'
          ]?.schema as JsonSchema | undefined)
        : undefined;

      ops.push({
        operationId: String(
          op.operationId ?? `${method}${path.replace(/[^A-Za-z0-9]/g, '_')}`,
        ),
        method,
        path,
        summary: op.summary as string | undefined,
        pathParams: allParams
          .filter((p) => p.in === 'path')
          .map(toParam),
        queryParams: allParams
          .filter((p) => p.in === 'query')
          .map(toParam),
        bodySchema,
        bodyRequired: body ? Boolean(body.required) : false,
        responseSchema: pickResponseSchema(op),
      });
    }
  }
  return ops;
}

function pickResponseSchema(op: Record<string, unknown>): JsonSchema | undefined {
  const responses = (op.responses as Record<string, unknown>) ?? {};
  const codes = Object.keys(responses)
    .filter((c) => /^2\d\d$/.test(c))
    .sort();
  for (const code of codes) {
    const r = responses[code] as Record<string, unknown>;
    const schema = (r.content as Record<string, { schema?: JsonSchema }>)?.[
      'application/json'
    ]?.schema;
    if (schema) return schema;
  }
  return undefined;
}

function paramsObjectSchema(params: Param[]): JsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(params.map((p) => [p.name, p.schema])),
    required: params.filter((p) => p.required).map((p) => p.name),
  };
}

/** Generate the SDK files from the OpenAPI document. */
export async function emitSdk(
  document: object,
  sdk: SdkConfig,
  cwd: string,
): Promise<string> {
  const doc = document as OADoc;
  const ctx: SchemaContext = { components: doc.components?.schemas ?? {} };
  const ops = collectOperations(doc);
  const className = sdk.className ?? 'ApiClient';
  const outDir = resolve(cwd, sdk.out ?? 'sdk');

  const schemaLines: string[] = [`import { z } from 'zod';`, ''];
  const typeLines: string[] = [
    `import type { z } from 'zod';`,
    `import type * as s from './schemas.js';`,
    '',
  ];

  for (const op of ops) {
    const id = op.operationId;
    if (op.responseSchema) {
      schemaLines.push(
        `export const ${id}Response = ${toZod(op.responseSchema, ctx)};`,
      );
    } else {
      schemaLines.push(`export const ${id}Response = z.void();`);
    }
    typeLines.push(
      `export type ${cap(id)}Response = z.infer<typeof s.${id}Response>;`,
    );

    if (op.pathParams.length) {
      schemaLines.push(
        `export const ${id}Params = ${toZod(paramsObjectSchema(op.pathParams), ctx)};`,
      );
      typeLines.push(
        `export type ${cap(id)}Params = z.infer<typeof s.${id}Params>;`,
      );
    }
    if (op.queryParams.length) {
      schemaLines.push(
        `export const ${id}Query = ${toZod(paramsObjectSchema(op.queryParams), ctx)};`,
      );
      typeLines.push(
        `export type ${cap(id)}Query = z.infer<typeof s.${id}Query>;`,
      );
    }
    if (op.bodySchema) {
      schemaLines.push(`export const ${id}Body = ${toZod(op.bodySchema, ctx)};`);
      typeLines.push(`export type ${cap(id)}Body = z.infer<typeof s.${id}Body>;`);
    }
    schemaLines.push('');
  }

  const clientSrc = renderClient(ops, className);
  const runtimeSrc = RUNTIME_SOURCE.replace(
    '__DEFAULT_BASE_URL__',
    JSON.stringify(sdk.baseUrl ?? ''),
  );

  const indexSrc = [
    `export * from './client.js';`,
    `export * from './runtime.js';`,
    `export * as schemas from './schemas.js';`,
    `export type * from './types.js';`,
    '',
  ].join('\n');

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(outDir, 'schemas.ts'), schemaLines.join('\n'), 'utf8'),
    writeFile(resolve(outDir, 'types.ts'), typeLines.join('\n') + '\n', 'utf8'),
    writeFile(resolve(outDir, 'runtime.ts'), runtimeSrc, 'utf8'),
    writeFile(resolve(outDir, 'client.ts'), clientSrc, 'utf8'),
    writeFile(resolve(outDir, 'index.ts'), indexSrc, 'utf8'),
  ]);

  return outDir;
}

function renderClient(ops: Operation[], className: string): string {
  const methods = ops.map((op) => renderMethod(op)).join('\n\n');
  return `import { BaseClient } from './runtime.js';
import type { RequestOptions } from './runtime.js';
import * as s from './schemas.js';
import type * as t from './types.js';

export class ${className} extends BaseClient {
${methods}
}
`;
}

function renderMethod(op: Operation): string {
  const id = op.operationId;
  const argFields: string[] = [];
  if (op.pathParams.length) argFields.push(`params: t.${cap(id)}Params`);
  if (op.queryParams.length) {
    const optional = op.queryParams.every((p) => !p.required);
    argFields.push(`query${optional ? '?' : ''}: t.${cap(id)}Query`);
  }
  if (op.bodySchema) {
    argFields.push(`body${op.bodyRequired ? '' : '?'}: t.${cap(id)}Body`);
  }

  const hasArgs = argFields.length > 0;
  const argsRequired =
    op.pathParams.length > 0 ||
    op.queryParams.some((p) => p.required) ||
    Boolean(op.bodySchema && op.bodyRequired);
  const argType = hasArgs ? `{ ${argFields.join('; ')} }` : '';
  const argParam = hasArgs
    ? `args: ${argType}${argsRequired ? '' : ' = {}'}, `
    : '';

  const argRef = hasArgs ? 'args' : '{}';
  const summary = op.summary ? `  /** ${op.summary} */\n` : '';

  return `${summary}  ${id}(${argParam}options?: RequestOptions) {
    return this.request(${JSON.stringify(op.method.toUpperCase())}, ${JSON.stringify(op.path)}, ${argRef}, s.${id}Response, options);
  }`;
}
