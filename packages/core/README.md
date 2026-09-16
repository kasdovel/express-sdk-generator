# @kasdovel/express-sdkgen-core

Runtime helpers for `sdkgen` to declare type-safe routes, perform runtime request validation, and serve API documentation.

## Installation

```bash
npm install @kasdovel/express-sdkgen-core zod express
# or
pnpm add @kasdovel/express-sdkgen-core zod express
# or
yarn add @kasdovel/express-sdkgen-core zod express
```

## Features

- **Zero-Drift Route Definitions**: Declare route schemas once using Zod. The same declaration validates incoming requests at runtime, types the handlers, and powers the generated OpenAPI spec, docs, and SDK.
- **Request Validation**: Automatically validates `params`, `query`, `body`, and `headers` against Zod schemas. Invalid requests receive a structured `400 Bad Request` response, and that response is documented for you (see below).
- **Type Safety**: Handlers automatically infer types for validated request parameters from Zod schemas under `req.valid`.
- **Response Validation**: `res.valid(status, payload)` checks an outgoing body against the schema the route declares for that status, so drift fails in your own test suite instead of your consumers'.
- **Nested Routers**: Create modular, nested APIs with prefix-aware routers that correctly serialize to OpenAPI paths.
- **Live Documentation**: Serve interactive Swagger/Redoc API documentation directly from your running Express application.

## Usage

### 1. Declare routes with `createRoute`

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { createRoute } from '@kasdovel/express-sdkgen-core';

export const router = Router();

createRoute(router, {
  method: 'post',
  path: '/users/:id',
  operationId: 'updateUser',
  request: {
    params: z.object({ id: z.string() }),
    body: z.object({ name: z.string().min(1) }),
  },
  responses: { 200: z.object({ id: z.string(), name: z.string() }) },
  handler: (req, res) => {
    // req.valid.params.id and req.valid.body.name are fully typed + validated
    res.json({ id: req.valid.params.id, name: req.valid.body.name });
  },
});
```

### 2. Validate what you send back with `res.valid`

`res.valid(status, payload)` parses the payload through that status's declared
schema before sending it. The status is narrowed to the codes the route declares
and the payload to the matching schema, so a rename caught nowhere else fails at
compile time — and, if it slips past the types, throws a `ResponseValidationError`
at runtime:

```typescript
createRoute(router, {
  method: 'get',
  path: '/users/:id',
  operationId: 'getUser',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: User, 404: ErrorBody },
  handler: (req, res) => {
    const user = find(req.valid.params.id);
    if (!user) return res.valid(404, { error: 'Not found' });
    res.valid(200, user); // res.valid(500, …) would not compile
  },
});
```

`res.json` is untouched — `res.valid` is purely additive, so existing handlers
keep working. Validation is on whenever `NODE_ENV !== 'production'` (drift is a
development bug, and parsing every response body is not something to put in front
of production traffic); set `validateResponses: true | false` on the route to
override that either way. `204`, `205`, and `304` are sent without a body.

### 3. Nest Routers with prefix-aware `router`

To mount routers under a prefix and preserve complete paths in the generated OpenAPI spec:

```typescript
import { router } from '@kasdovel/express-sdkgen-core';

const accounts = router('/accounts');

accounts.route({
  method: 'get',
  path: '/',
  operationId: 'listAccounts',
  responses: { 200: AccountListSchema },
  handler: (req, res) => { ... },
});

// Nesting sub-routers
const admins = accounts.router('/admins');
admins.route({
  method: 'get',
  path: '/:id',
  operationId: 'getAdmin',
  responses: { 200: AdminSchema },
  handler: (req, res) => { ... },
});

// Mount the top-level router onto the Express app
accounts.mount(app);
```

### 4. Serve live documentation

Serve Swagger UI or Redoc documentation from the in-memory route registry:

```typescript
import { registry, serveDocs } from '@kasdovel/express-sdkgen-core';
import express from 'express';

const app = express();

// Serve docs at /docs
await serveDocs(app, {
  registry,
  title: 'My Express API',
  version: '1.0.0',
  path: '/docs',
});
```

## The documented 400

Any route with a `request` schema can be answered with
`400 { error: 'ValidationError', part, issues }` by the validation middleware, so
that response is added to the document automatically, referencing a shared
`#/components/schemas/ValidationError`. The component and the body the middleware
sends are derived from one exported schema (`ValidationErrorSchema`), so they
cannot drift apart.

A route that declares its own `400` keeps it — yours is never overwritten. If
your app replaces the default `onError` with a different error envelope
everywhere, turn the feature off with `validationErrors: false` in the document
options.

## Authentication

Declare security schemes on the document and requirements on the routes. This is
declaration only: it makes the spec correct and gives the docs an "Authorize"
button. Enforcing the scheme stays your application's job.

```typescript
await serveDocs(app, {
  title: 'My Express API',
  version: '1.0.0',
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
  security: [{ bearerAuth: [] }], // document-wide default
});

createRoute(router, {
  method: 'post',
  path: '/login',
  operationId: 'login',
  security: [], // explicitly public: overrides the document-wide default
  responses: { 200: TokenSchema },
  handler: (req, res) => { ... },
});
```

## License

MIT
