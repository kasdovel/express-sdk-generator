import type { z } from 'zod';

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

/** A single status-code response: a Zod schema plus optional description. */
export interface ResponseDef {
  schema: z.ZodTypeAny;
  description?: string;
}

/** Schemas describing an incoming request. All parts optional. */
export interface RequestSchemas {
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
}

/**
 * The canonical record for one operation. The registry holds these with the
 * real Zod objects intact — this is the single source of truth that both the
 * OpenAPI spec and the SDK are generated from.
 */
export interface RouteDef {
  method: Method;
  /** Express-style path, e.g. `/users/:id`. */
  path: string;
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  request?: RequestSchemas;
  /** Keyed by HTTP status code. */
  responses: Record<number, ResponseDef>;
}
