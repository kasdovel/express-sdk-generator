# sdkgen

Generate an **OpenAPI spec**, **Swagger/Redoc docs**, and a **typed TypeScript SDK**
from an Express + TypeScript app — from a single Zod declaration per route, with no drift.

One source of truth: you declare Zod schemas once with `createRoute`. That same
declaration drives runtime request validation, the OpenAPI document, the docs, and the
generated SDK (which validates responses with the same schemas).

## Packages

| Package | Role | Install as |
|---------|------|-----------|
| [`@sdkgen/core`](packages/core) | Runtime: `createRoute`, registry, request validation, `serveDocs` | `dependency` |
| [`@sdkgen/cli`](packages/cli) | Generator CLI (`sdkgen`) | `devDependency` |

## Usage

### 1. Declare routes with `createRoute`

```ts
import { Router } from 'express';
import { z } from 'zod';
import { createRoute } from '@sdkgen/core';

export const router: Router = Router();

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
    // req.valid.params.id and req.valid.body.name are typed + validated
    res.json({ id: req.valid.params.id, name: req.valid.body.name });
  },
});
```

`createRoute` registers the route, installs validation middleware (auto-400 on a bad
request), and types the handler.

### 2. Expose a side-effect-free entry

```ts
// src/openapi.ts
import './routes.js';            // populates the registry
export { registry } from '@sdkgen/core';
```

The entry must not call `app.listen()` — the CLI imports it in-process via `jiti`.

### 3. Configure

```ts
// sdkgen.config.ts
import { defineConfig } from '@sdkgen/cli';

export default defineConfig({
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', openapi: '3.1', title: 'My API', version: '1.0.0', yaml: true },
  docs: { out: 'docs/index.html', ui: 'swagger' },
  sdk:  { out: 'sdk', baseUrl: 'https://api.example.com', className: 'ApiClient' },
});
```

### 4. Generate

```bash
sdkgen gen all      # spec + docs + sdk
sdkgen gen spec     # just the OpenAPI spec
sdkgen gen sdk      # just the SDK
sdkgen serve        # live docs preview
```

### Generated SDK

```ts
import { ApiClient } from './sdk';

const api = new ApiClient({ baseUrl: 'https://api.example.com' });
const user = await api.updateUser({ params: { id: '1' }, body: { name: 'Ada' } });
// `user` is typed; the response is validated against the route's Zod schema.
```

The client transport is pluggable (defaults to native `fetch`); pass `{ fetch }` to inject
your own. Responses are always validated, so server/SDK drift throws instead of silently
mis-typing.

### Nested routers

`createRoute` records the literal path you pass it — it can't see where a router is later
mounted. For routers mounted under a prefix, use a prefix-aware `router` so the registry gets
the fully-qualified path while Express still routes by the local path:

```ts
import { router } from '@sdkgen/core';

const accounts = router('/accounts');
accounts.route({ method: 'get', path: '/', operationId: 'listAccounts', responses: { 200: AccountList }, handler });

const admins = accounts.router('/admins');       // nested router, mounted under /admins
admins.route({ method: 'get', path: '/:id', operationId: 'getAdmin', request: { params: IdParam }, responses: { 200: Admin }, handler });

accounts.mount(app);   // mounts the /accounts router (and its /admins sub-router)
// spec paths: /accounts and /accounts/admins/{id}
```

Routers nest to any depth; the prefix is written once per level. The raw Express router is
hidden — mount with `.mount(app)`. Plain `createRoute` is the special case of a router at the
app root, so a root-mounted router needs no `router(...)` wrapper.

### Live docs in your own app

```ts
import { registry, serveDocs } from '@sdkgen/core';
await serveDocs(app, { registry, title: 'My API', version: '1.0.0', path: '/docs' });
```

## Development

```bash
pnpm install
pnpm build        # turbo: build core then cli
pnpm test         # all package + example tests
```

See [`examples/api`](examples/api) for a complete working app and its e2e test.
