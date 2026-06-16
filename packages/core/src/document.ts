import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { Registry } from './registry.js';
import type { RouteDef } from './types.js';
import { toOpenApiPath } from './path.js';

// Patch the shared zod instance so `.openapi()` metadata is understood. Safe to
// call repeatedly; it is idempotent on the prototype.
extendZodWithOpenApi(z);

export type OpenApiVersion = '3.0' | '3.1';

export interface DocumentInfo {
  title: string;
  version: string;
  description?: string;
  openapi?: OpenApiVersion;
  servers?: { url: string; description?: string }[];
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

function describe(code: number): string {
  return STATUS_TEXT[code] ?? `Status ${code}`;
}

function registerRoute(oapi: OpenAPIRegistry, route: RouteDef): void {
  const responses: Record<number, unknown> = {};
  for (const [code, def] of Object.entries(route.responses)) {
    const n = Number(code);
    const entry: Record<string, unknown> = {
      description: def.description ?? describe(n),
    };
    // 204 / empty bodies: omit content.
    if (n !== 204) {
      entry.content = { 'application/json': { schema: def.schema } };
    }
    responses[n] = entry;
  }

  const request: Record<string, unknown> = {};
  if (route.request?.params) request.params = route.request.params;
  if (route.request?.query) request.query = route.request.query;
  if (route.request?.headers) request.headers = route.request.headers;
  if (route.request?.body) {
    request.body = {
      required: true,
      content: { 'application/json': { schema: route.request.body } },
    };
  }

  oapi.registerPath({
    method: route.method,
    path: toOpenApiPath(route.path),
    operationId: route.operationId,
    summary: route.summary,
    description: route.description,
    tags: route.tags,
    request: Object.keys(request).length ? request : undefined,
    responses,
  } as Parameters<OpenAPIRegistry['registerPath']>[0]);
}

/** Build an OpenAPI document object from a populated Registry. */
export function buildDocument(registry: Registry, info: DocumentInfo): object {
  const oapi = new OpenAPIRegistry();
  for (const route of registry.routes) registerRoute(oapi, route);

  const version = info.openapi ?? '3.1';
  const base = {
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    servers: info.servers,
  };

  if (version === '3.0') {
    const generator = new OpenApiGeneratorV3(oapi.definitions);
    return generator.generateDocument({ openapi: '3.0.3', ...base });
  }
  const generator = new OpenApiGeneratorV31(oapi.definitions);
  return generator.generateDocument({ openapi: '3.1.0', ...base });
}
