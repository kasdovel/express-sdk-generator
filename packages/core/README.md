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
- **Request Validation**: Automatically validates `params`, `query`, `body`, and `headers` against Zod schemas. Invalid requests receive a structured `400 Bad Request` response.
- **Type Safety**: Handlers automatically infer types for validated request parameters from Zod schemas under `req.valid`.
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

### 2. Nest Routers with prefix-aware `router`

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

### 3. Serve live documentation

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

## License

MIT
