import type { Router, Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import type { Method, ResponseDef, RouteDef } from './types.js';
import { Registry, registry as globalRegistry } from './registry.js';
import {
  validateRequest,
  type ValidationOptions,
  type ValidatedData,
} from './validate.js';

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

export type TypedHandler<P, Q, B, H> = (
  req: TypedRequest<P, Q, B, H>,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/** A status-code response: either a bare Zod schema or `{ schema, description }`. */
export type ResponseInput = z.ZodTypeAny | ResponseDef;

export interface CreateRouteConfig<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
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
  responses: Record<number, ResponseInput>;
  /** Customize the 400 validation response. */
  validation?: ValidationOptions;
  /** Registry to record into. Defaults to the global registry. */
  registry?: Registry;
  handler: TypedHandler<P, Q, B, H>;
}

function isZodSchema(value: ResponseInput): value is z.ZodTypeAny {
  return typeof (value as { safeParse?: unknown }).safeParse === 'function';
}

function normalizeResponses(
  responses: Record<number, ResponseInput>,
): Record<number, ResponseDef> {
  const out: Record<number, ResponseDef> = {};
  for (const [code, value] of Object.entries(responses)) {
    out[Number(code)] = isZodSchema(value) ? { schema: value } : value;
  }
  return out;
}

/**
 * Register one route on an Express router. In a single call this:
 *  1. records the operation (with real Zod schemas) into the registry,
 *  2. installs request-validation middleware that 400s on a bad request,
 *  3. types the handler so `req.valid.{params,query,body,headers}` are inferred.
 */
export function createRoute<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
>(router: Router, config: CreateRouteConfig<P, Q, B, H>): Router {
  const reg = config.registry ?? globalRegistry;

  const route: RouteDef = {
    method: config.method,
    path: config.path,
    operationId: config.operationId,
    summary: config.summary,
    description: config.description,
    tags: config.tags,
    request: config.request,
    responses: normalizeResponses(config.responses),
  };
  reg.add(route);

  const validator = validateRequest(config.request, config.validation);

  const handler = config.handler;
  const wrapped = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const out = handler(
        req as TypedRequest<P, Q, B, H>,
        res,
        next,
      );
      if (out instanceof Promise) out.catch(next);
    } catch (err) {
      next(err);
    }
  };

  router[config.method](config.path, validator, wrapped);
  return router;
}

export type { ValidatedData };
