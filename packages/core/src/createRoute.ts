import type { Router, Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import type { Method, ResponseDef, RouteDef, SecurityRequirement } from './types.js';
import { type Registry, registry as globalRegistry } from './registry.js';
import { validateRequest, type ValidationOptions, type ValidatedData } from './validate.js';
import { pathParamNames } from './path.js';
import { makeValidResponder, type TypedResponse } from './respond.js';

type Infer<S> = S extends z.ZodTypeAny ? z.infer<S> : unknown;

/** Validated request data, with each part typed from its Zod schema. */
export interface Valid<P, Q, B, H> {
  params: Infer<P>;
  query: Infer<Q>;
  body: Infer<B>;
  headers: Infer<H>;
}

export type TypedRequest<P, Q, B, H> = Request & {
  valid: Valid<P, Q, B, H>;
};

/** A status-code response: either a bare Zod schema or `{ schema, description }`. */
export type ResponseInput = z.ZodTypeAny | ResponseDef;

/** The shape of a route's `responses` map before normalization. */
export type ResponsesInput = Record<number, ResponseInput>;

export type TypedHandler<P, Q, B, H, R = ResponsesInput> = (
  req: TypedRequest<P, Q, B, H>,
  res: TypedResponse<R>,
  next: NextFunction,
) => void | Promise<void>;

export interface CreateRouteConfig<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
  R extends ResponsesInput = ResponsesInput,
> {
  method: Method;
  /** Express-style path, e.g. `/users/:id`. */
  path: string;
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  request?: { params?: P; query?: Q; body?: B; headers?: H };
  /** Keyed by HTTP status code. */
  responses: R;
  /**
   * Security requirements for this operation, e.g. `[{ bearerAuth: [] }]`. The
   * scheme names must be declared in the document's `securitySchemes`. Omit to
   * inherit the document-wide default; pass `[]` to opt out of it.
   */
  security?: SecurityRequirement[];
  /** Customize the 400 validation response. */
  validation?: ValidationOptions;
  /**
   * Parse payloads passed to `res.valid()` against the declared response schema.
   * Defaults to on outside production (`NODE_ENV !== 'production'`).
   */
  validateResponses?: boolean;
  /** Registry to record into. Defaults to the global registry. */
  registry?: Registry;
  handler: TypedHandler<P, Q, B, H, R>;
}

function isZodSchema(value: ResponseInput): value is z.ZodTypeAny {
  return typeof (value as { safeParse?: unknown }).safeParse === 'function';
}

function normalizeResponses(responses: ResponsesInput): Record<number, ResponseDef> {
  const out: Record<number, ResponseDef> = {};
  for (const [code, value] of Object.entries(responses)) {
    out[Number(code)] = isZodSchema(value) ? { schema: value } : value;
  }
  return out;
}

/**
 * Keys of a Zod object schema, or `undefined` if the schema is not a plain
 * object (e.g. wrapped in `.refine()`), in which case we cannot introspect it.
 */
function objectKeys(schema: z.ZodTypeAny | undefined): string[] | undefined {
  const shape: unknown = (schema as { shape?: unknown } | undefined)?.shape;
  if (!shape || typeof shape !== 'object') return undefined;
  return Object.keys(shape);
}

function quoteList(names: string[]): string {
  return names.map((n) => `":${n}"`).join(', ');
}

/**
 * A `:param` in the path that no `request.params` schema declares never reaches
 * the spec, so the generated SDK has no argument to fill that URL segment and
 * silently requests `/users/undefined`. Fail at registration instead.
 */
function assertPathParamsDeclared(route: RouteDef): void {
  const declared = pathParamNames(route.path);
  if (declared.length === 0) return;

  const at = `${route.method.toUpperCase()} ${route.path} (operationId "${route.operationId}")`;
  const suggestion = `request: { params: z.object({ ${declared
    .map((n) => `${n}: z.string()`)
    .join(', ')} }) }`;

  const keys = objectKeys(route.request?.params);
  if (keys === undefined) {
    // No schema at all is an error; a non-introspectable schema we have to trust.
    if (route.request?.params) return;
    throw new Error(
      `${at} declares path parameter${declared.length > 1 ? 's' : ''} ${quoteList(declared)} ` +
        `but has no "request.params" schema. Add \`${suggestion}\` — without it the OpenAPI ` +
        'spec documents no parameter and the generated SDK cannot fill the URL.',
    );
  }

  const missing = declared.filter((name) => !keys.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `${at} declares path parameter${missing.length > 1 ? 's' : ''} ${quoteList(missing)} ` +
        `that "request.params" does not describe (it has: ${
          keys.length ? keys.map((k) => `"${k}"`).join(', ') : 'no keys'
        }). Add ${missing.length > 1 ? 'them' : 'it'} so the spec and SDK carry the parameter.`,
    );
  }
}

/**
 * Register one route on an Express router. In a single call this:
 *  1. records the operation (with real Zod schemas) into the registry,
 *  2. installs request-validation middleware that 400s on a bad request,
 *  3. types the handler so `req.valid.{params,query,body,headers}` are inferred,
 *  4. installs `res.valid(status, payload)`, typed from `responses`.
 */
export function createRoute<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
  R extends ResponsesInput = ResponsesInput,
>(router: Router, config: CreateRouteConfig<P, Q, B, H, R>): Router {
  const reg = config.registry ?? globalRegistry;
  return registerRoute(router, config, reg, config.path);
}

/**
 * Shared registration core. `expressPath` is what the route is mounted at on
 * `router` (local, relative to where `router` is mounted); `registryPath` is the
 * absolute path recorded in the spec. They differ when a router is nested under
 * a prefix — see `router` / `ApiRouter`.
 */
export function registerRoute<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
  R extends ResponsesInput = ResponsesInput,
>(
  router: Router,
  config: CreateRouteConfig<P, Q, B, H, R>,
  registry: Registry,
  registryPath: string,
): Router {
  const route: RouteDef = {
    method: config.method,
    path: registryPath,
    operationId: config.operationId,
    summary: config.summary,
    description: config.description,
    tags: config.tags,
    request: config.request,
    responses: normalizeResponses(config.responses),
    security: config.security,
  };
  assertPathParamsDeclared(route);
  registry.add(route);

  const validator = validateRequest(config.request, config.validation);
  const respond = makeValidResponder(config.operationId, route.responses, config.validateResponses);

  const handler = config.handler;
  const wrapped = (req: Request, res: Response, next: NextFunction): void => {
    // Attached per request rather than on the prototype: the schemas are this
    // route's, and two routes on the same app declare different ones.
    const typedRes = res as TypedResponse<R>;
    typedRes.valid = ((status: number, payload: unknown) =>
      respond(res, status, payload)) as TypedResponse<R>['valid'];

    try {
      const out = handler(req as TypedRequest<P, Q, B, H>, typedRes, next);
      if (out instanceof Promise) out.catch(next);
    } catch (err) {
      next(err);
    }
  };

  router[config.method](config.path, validator, wrapped);
  return router;
}

export type { ValidatedData };
