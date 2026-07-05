import type { Request, RequestHandler, Response, NextFunction } from 'express';
import type { z } from 'zod';
import type { RequestSchemas } from './types.js';

/** Which part of the request failed validation. */
export type RequestPart = 'params' | 'query' | 'body' | 'headers';

export interface ValidationFailure {
  part: RequestPart;
  issues: z.ZodIssue[];
}

export interface ValidationOptions {
  /**
   * Customize the 400 response. Default emits
   * `{ error: 'ValidationError', part, issues }`.
   */
  onError?: (failure: ValidationFailure, req: Request, res: Response, next: NextFunction) => void;
}

/** Container of validated request data, attached to `req.valid`. */
export interface ValidatedData {
  params: unknown;
  query: unknown;
  body: unknown;
  headers: unknown;
}

function defaultOnError(failure: ValidationFailure, _req: Request, res: Response): void {
  res.status(400).json({
    error: 'ValidationError',
    part: failure.part,
    issues: failure.issues,
  });
}

const PART_SOURCES: RequestPart[] = ['params', 'query', 'body', 'headers'];

/**
 * Build a middleware that parses the configured request parts through Zod.
 * On success the parsed (coerced, defaulted) values are placed on `req.valid`;
 * the original `req.query`/`req.params`/`req.body` are left untouched so this
 * works under both Express 4 and Express 5 (where `req.query` is read-only).
 * On failure it responds 400 (or defers to `onError`).
 */
export function validateRequest(
  request: RequestSchemas | undefined,
  options: ValidationOptions = {},
): RequestHandler {
  const onError = options.onError ?? defaultOnError;

  return (req, res, next) => {
    const valid: ValidatedData = {
      params: req.params,
      query: req.query,
      body: req.body,
      headers: req.headers,
    };

    if (request) {
      for (const part of PART_SOURCES) {
        const schema = request[part];
        if (!schema) continue;
        const result = schema.safeParse((req as unknown as Record<string, unknown>)[part]);
        if (!result.success) {
          onError({ part, issues: result.error.issues }, req, res, next);
          return;
        }
        valid[part] = result.data;
      }
    }

    (req as Request & { valid: ValidatedData }).valid = valid;
    next();
  };
}
