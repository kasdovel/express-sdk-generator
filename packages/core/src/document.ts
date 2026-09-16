import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { Registry } from './registry.js';
import type { RouteDef, SecurityRequirement, SecurityScheme } from './types.js';
import { toOpenApiPath } from './path.js';
import { BODYLESS_STATUSES } from './respond.js';
import { VALIDATION_ERROR_SCHEMA_NAME, ValidationErrorSchema } from './validationError.js';

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
  /**
   * Document the 400 that request validation already answers with. Every route
   * declaring a `request` schema gets a 400 referencing a shared
   * `#/components/schemas/ValidationError`, unless it declares its own 400.
   *
   * Default `true`: the middleware can always send that response, so leaving it
   * out of the spec is drift in this library's own output. Turn it off if your
   * app replaces the default `onError` with a different error envelope.
   */
  validationErrors?: boolean;
  /**
   * Named security schemes, emitted as `components.securitySchemes`. Routes (and
   * `security` below) reference them by name.
   *
   *   securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }
   */
  securitySchemes?: Record<string, SecurityScheme>;
  /**
   * Document-wide default security requirement, applied to every operation that
   * does not declare its own `security`.
   */
  security?: SecurityRequirement[];
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  205: 'Reset Content',
  304: 'Not Modified',
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

/** Does this route have at least one request schema for the middleware to check? */
function hasRequestSchemas(route: RouteDef): boolean {
  const request = route.request;
  if (!request) return false;
  return Boolean(request.params ?? request.query ?? request.body ?? request.headers);
}

function registerRoute(
  oapi: OpenAPIRegistry,
  route: RouteDef,
  validationErrorRef: z.ZodTypeAny | undefined,
): void {
  const responses: Record<number, unknown> = {};
  for (const [code, def] of Object.entries(route.responses)) {
    const n = Number(code);
    const entry: Record<string, unknown> = {
      description: def.description ?? describe(n),
    };
    // 204/205/304 carry no body by definition; emitting `content` would have the
    // generated SDK try to parse an empty response as JSON.
    if (!BODYLESS_STATUSES.includes(n)) {
      entry.content = { 'application/json': { schema: def.schema } };
    }
    responses[n] = entry;
  }

  // The validation middleware can always answer 400 for a route with request
  // schemas, so document it — but never over a 400 the user declared themselves:
  // their envelope is the one their `onError` actually sends.
  if (validationErrorRef && hasRequestSchemas(route) && responses[400] === undefined) {
    responses[400] = {
      description: 'The request did not match the schemas declared for this operation.',
      content: { 'application/json': { schema: validationErrorRef } },
    };
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
    // Emitted only when the route declares it. Everything else inherits the
    // document-wide default, and an explicit `[]` overrides that default to mark
    // the operation public.
    security: route.security,
    request: Object.keys(request).length ? request : undefined,
    responses,
  } as Parameters<OpenAPIRegistry['registerPath']>[0]);
}

/**
 * Register the shared `ValidationError` component, but only if some route will
 * actually reference it — an unused component in the spec is noise.
 *
 * Returns the *registered* schema: `register()` returns a copy carrying the
 * component's refId, and it is that copy which serializes to a `$ref` instead of
 * being inlined into every operation.
 */
function registerValidationError(
  oapi: OpenAPIRegistry,
  registry: Registry,
  enabled: boolean,
): z.ZodTypeAny | undefined {
  if (!enabled) return undefined;
  const needed = registry.routes.some(
    (route) => hasRequestSchemas(route) && route.responses[400] === undefined,
  );
  if (!needed) return undefined;
  return oapi.register(VALIDATION_ERROR_SCHEMA_NAME, ValidationErrorSchema);
}

/** Build an OpenAPI document object from a populated Registry. */
export function buildDocument(registry: Registry, info: DocumentInfo): object {
  const oapi = new OpenAPIRegistry();

  // `registerComponent` is typed against openapi3-ts' 3.0/3.1 union, which
  // resolves to `any` through the generic. `SecurityScheme` is the structural
  // subset common to both versions, so narrow the method to it once here rather
  // than casting at each call.
  const registerSecurityScheme = oapi.registerComponent.bind(oapi) as (
    type: 'securitySchemes',
    name: string,
    component: SecurityScheme,
  ) => unknown;
  for (const [name, scheme] of Object.entries(info.securitySchemes ?? {})) {
    registerSecurityScheme('securitySchemes', name, scheme);
  }

  const validationErrorRef = registerValidationError(oapi, registry, info.validationErrors ?? true);
  for (const route of registry.routes) registerRoute(oapi, route, validationErrorRef);

  const version = info.openapi ?? '3.1';
  const base = {
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    servers: info.servers,
    security: info.security,
  };

  if (version === '3.0') {
    const generator = new OpenApiGeneratorV3(oapi.definitions);
    return generator.generateDocument({ openapi: '3.0.3', ...base });
  }
  const generator = new OpenApiGeneratorV31(oapi.definitions);
  return generator.generateDocument({ openapi: '3.1.0', ...base });
}
