// Compile-time contract for `res.valid`. Every `@ts-expect-error` below is an
// assertion that the line *does not* compile, so `tsc` failing on this file —
// either because a good call broke or because a bad call started compiling — is
// a real regression. `types.test.ts` runs `tsc` over it.
import { Router } from 'express';
import { z } from 'zod';
import { createRoute, router as apiRouter } from '../../src/index.js';

const User = z.object({ id: z.string(), name: z.string() });

createRoute(Router(), {
  method: 'get',
  path: '/users/:id',
  operationId: 'getUser',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: User, 404: z.object({ error: z.string() }) },
  handler: (req, res) => {
    const id: string = req.valid.params.id;

    // Declared statuses, with payloads inferred from their schemas.
    res.valid(200, { id, name: 'Ada' });
    res.valid(404, { error: 'not found' });

    // `res.valid` is additive: the rest of Express' Response still works.
    res.status(200).json({ whatever: true });

    // @ts-expect-error 500 is not one of this route's declared responses
    res.valid(500, { error: 'boom' });
    // @ts-expect-error the 200 schema declares `id` as a string
    res.valid(200, { id: 1, name: 'Ada' });
    // @ts-expect-error the 200 schema requires `name`
    res.valid(200, { id });
  },
});

// `{ schema, description }` form and a bodyless status, through ApiRouter.
apiRouter('/accounts').route({
  method: 'post',
  path: '/',
  operationId: 'createAccount',
  request: { body: z.object({ name: z.string() }) },
  responses: { 201: { schema: User, description: 'Created' }, 204: z.undefined() },
  handler: (req, res) => {
    res.valid(201, { id: '1', name: req.valid.body.name });
    res.valid(204, undefined);
    // @ts-expect-error 200 is not one of this route's declared responses
    res.valid(200, { id: '1', name: 'Ada' });
  },
});

// A handler written against the plain Express types still compiles: `res.valid`
// is additional structure, so existing routes are unaffected.
createRoute(Router(), {
  method: 'get',
  path: '/legacy',
  operationId: 'legacy',
  responses: { 200: z.string() },
  handler: (_req, res) => {
    res.json('ok');
  },
});
