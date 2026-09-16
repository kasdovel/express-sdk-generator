import type { Response } from 'express';
import type { z } from 'zod';
import type { ResponseDef } from './types.js';

/**
 * Statuses that must not carry a body. Sending one anyway is a protocol
 * violation, and an SDK generated from the spec would try to parse the empty
 * body as JSON.
 */
export const BODYLESS_STATUSES: readonly number[] = [204, 205, 304];

/** Thrown when a handler tries to send a payload its route does not describe. */
export class ResponseValidationError extends Error {
  readonly operationId: string;
  readonly status: number;
  readonly issues: z.ZodIssue[];

  constructor(operationId: string, status: number, issues: z.ZodIssue[]) {
    const detail = issues
      .map((i) => `${i.path.length ? i.path.join('.') : '<root>'}: ${i.message}`)
      .join('; ');
    super(
      `Response for "${operationId}" does not match its declared ${status} schema — ${detail}. ` +
        'The spec, docs, and generated SDK all promise that shape, so shipping this would ' +
        'break every consumer at runtime.',
    );
    this.name = 'ResponseValidationError';
    this.operationId = operationId;
    this.status = status;
    this.issues = issues;
  }
}

/** Thrown when a handler sends a status the route never declared. */
export class UndeclaredResponseError extends Error {
  readonly operationId: string;
  readonly status: number;

  constructor(operationId: string, status: number, declared: number[]) {
    super(
      `Route "${operationId}" declares no ${status} response (it declares ` +
        `${declared.length ? declared.join(', ') : 'none'}), so res.valid(${status}, …) has ` +
        'nothing to validate against. Add it to `responses` or use res.status().json().',
    );
    this.name = 'UndeclaredResponseError';
    this.operationId = operationId;
    this.status = status;
  }
}

/** The payload `res.valid(status, …)` accepts for one declared response. */
export type ResponsePayload<T> = T extends z.ZodTypeAny
  ? z.input<T>
  : T extends { schema: infer S }
    ? S extends z.ZodTypeAny
      ? z.input<S>
      : unknown
    : unknown;

/**
 * An Express response plus `res.valid`: a `res.json` that first checks what it
 * is about to send against the schema the route declared for that status. `R` is
 * the route's `responses` map, so the status argument is narrowed to the
 * declared codes and the payload to the matching schema's input type.
 *
 * `res.json`, `res.status`, and the rest of `Response` are untouched —
 * `res.valid` is purely additive.
 */
export type TypedResponse<R> = Response & {
  valid<S extends Extract<keyof R, number>>(status: S, payload: ResponsePayload<R[S]>): Response;
};

/**
 * Should outgoing responses be parsed? Drift is a *development* bug, and
 * catching it costs a full parse of every response body — not something to put
 * in front of production traffic. So: on everywhere else, where it fails in the
 * API's own test suite (the whole point of the helper), off in production, and
 * overridable per route either way.
 *
 * Read per call rather than at registration time so a test can flip `NODE_ENV`
 * around an assertion, and so an app that imports its routes before loading its
 * env config still gets the right answer. It is one property read next to a
 * JSON encode.
 */
function validationEnabled(override: boolean | undefined): boolean {
  return override ?? process.env.NODE_ENV !== 'production';
}

/**
 * Build the `res.valid` implementation for one route. It lives here rather than
 * in `createRoute.ts` so the runtime sits next to the types that describe it.
 */
export function makeValidResponder(
  operationId: string,
  responses: Record<number, ResponseDef>,
  validate: boolean | undefined,
): (res: Response, status: number, payload: unknown) => Response {
  return (res, status, payload) => {
    const def = responses[status];
    if (!def) {
      throw new UndeclaredResponseError(
        operationId,
        status,
        Object.keys(responses)
          .map(Number)
          .sort((a, b) => a - b),
      );
    }

    let body = payload;
    if (validationEnabled(validate)) {
      const result = def.schema.safeParse(payload);
      if (!result.success) {
        throw new ResponseValidationError(operationId, status, result.error.issues);
      }
      // Send the *parsed* value: defaults and transforms declared in the schema
      // are part of what the spec promises, so the wire has to carry them.
      body = result.data;
    }

    if (BODYLESS_STATUSES.includes(status)) return res.status(status).end();
    return res.status(status).json(body);
  };
}
