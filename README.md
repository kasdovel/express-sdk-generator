# sdkgen

Generate an **OpenAPI spec**, **Swagger/Redoc docs**, and a **typed TypeScript SDK**
from an Express + TypeScript app — from a single Zod declaration per route, with no drift.

One source of truth: you declare Zod schemas once with `createRoute`. That same
declaration drives runtime request validation, the OpenAPI document, the docs, and the
generated SDK (which validates responses with the same schemas).

## Packages

| Package                                          | Role                                                              | Install as      |
| ------------------------------------------------ | ----------------------------------------------------------------- | --------------- |
| [`@kasdovel/express-sdkgen-core`](packages/core) | Runtime: `createRoute`, registry, request validation, `serveDocs` | `dependency`    |
| [`@kasdovel/express-sdkgen-cli`](packages/cli)   | Generator CLI (`sdkgen`)                                          | `devDependency` |

## Usage

### 1. Declare routes with `createRoute`

```ts
import { Router } from 'express';
import { z } from 'zod';
import { createRoute } from '@kasdovel/express-sdkgen-core';

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
import './routes.js'; // populates the registry
export { registry } from '@kasdovel/express-sdkgen-core';
```

The entry must not call `app.listen()` — the CLI imports it in-process via `jiti`.

### 3. Configure

```ts
// sdkgen.config.ts
import { defineConfig } from '@kasdovel/express-sdkgen-cli';

export default defineConfig({
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', openapi: '3.1', title: 'My API', version: '1.0.0', yaml: true },
  docs: { out: 'docs/index.html', ui: 'swagger', offline: false },
  sdk: { out: 'sdk', baseUrl: 'https://api.example.com', className: 'ApiClient' },
});
```

### 4. Generate

```bash
sdkgen init         # scaffold a config and a side-effect-free entry
sdkgen gen all      # spec + docs + sdk
sdkgen gen spec     # just the OpenAPI spec
sdkgen gen sdk      # just the SDK
sdkgen gen all -w   # regenerate whenever a route changes
sdkgen check        # fail if the committed artifacts are stale
sdkgen serve        # live docs preview, reloads on change
```

### Keeping it honest in CI

Nothing stops someone editing a route and committing without regenerating, so
`check` turns "no drift" from a claim into a gate. It regenerates everything and
compares against what is committed, printing what differs and exiting non-zero:

```yaml
- run: npx sdkgen check
```

The generated docs HTML always inlines the OpenAPI spec. By default the Swagger/Redoc UI
assets load from a CDN (unpkg/jsdelivr) at runtime. Set `docs.offline: true` to vendor those
assets into the file as well, producing a single air-gapped page that needs no public
internet — at the cost of a larger HTML file.

### Generated SDK

```ts
import { ApiClient } from './sdk';

const api = new ApiClient({ baseUrl: 'https://api.example.com' });
const user = await api.updateUser({ params: { id: '1' }, body: { name: 'Ada' } });
// `user` is typed; the response is validated against the route's Zod schema.
```

The client transport is pluggable per HTTP method. Pass a client-wide `transport`, or a
`transports` map to override individual methods — each is an async function that carries one
request and returns `{ status, data }` (already parsed), so axios or a custom/cached fetcher
drops in without a text round-trip:

```ts
import axios from 'axios';

const api = new ApiClient({
  baseUrl: 'https://api.example.com',
  transports: {
    // A caching/custom fetcher just for GET; everything else uses the default.
    GET: async ({ url, headers, signal }) => {
      const res = await axios.get(url, {
        headers,
        signal,
        validateStatus: () => true, // must not throw on non-2xx
      });
      return { status: res.status, data: res.data };
    },
  },
});
```

The default transport uses native `fetch`. Whatever the transport, the SDK owns the rest:
it merges headers, turns a non-2xx `status` into `ApiError`, and always validates the response
against the route's Zod schema — so server/SDK drift throws instead of silently mis-typing.
A non-2xx body that isn't JSON (a proxy's HTML error page, say) still arrives as
`ApiError(status, body)` with the raw text, never as a JSON parse error.

Every emitted file starts with `/* eslint-disable */` and an `@generated` marker: the SDK is
build output, meant to be regenerated and committed, not hand-edited.

#### Typed errors

The error responses a route declares are generated too, so a caught `ApiError`
narrows to the shape the route promised for that status:

```ts
import { isApiError } from './sdk';

try {
  await api.getUser({ params: { id } });
} catch (err) {
  if (isApiError(err, 404)) err.body.error; // typed from the route's 404 schema
  if (isApiError(err, 400)) err.body.issues; // the ValidationError body, documented below
}
```

#### Status and headers

Each operation also gets a `…WithResponse` sibling when you need more than the body —
pagination headers, `ETag`, rate limits:

```ts
const { status, headers, data } = await api.listUsersWithResponse();
```

#### Validating arguments before sending

Set `sdk: { validateRequests: true }` and the client parses arguments through the
operation's own schemas before the request leaves, so a bad call fails locally with a
`ZodError` instead of as a 400 — and declared defaults and coercions apply client-side.

### Catching response drift on the server

The SDK validates responses in the _consumer's_ process, which is the last place you want to
find out. `res.valid` checks a payload against the schema the route declared before it goes
out, so drift fails in your own test suite instead:

```ts
createRoute(router, {
  method: 'get',
  path: '/users/:id',
  operationId: 'getUser',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: User, 404: ErrorBody },
  handler: (req, res) => {
    const user = findUser(req.valid.params.id);
    if (!user) return res.valid(404, { error: 'User not found' });
    res.valid(200, user); // throws if `user` does not match `User`
  },
});
```

The status argument is narrowed to the codes the route declares and the payload to that
status's schema, so an undeclared status or a wrong shape is a compile error too. Validation
runs outside production by default (`validateResponses` overrides it per route), and `res.json`
is untouched.

### The validation 400 is documented for you

`createRoute` already answers `400 { error: 'ValidationError', part, issues }` whenever a
request fails its schemas. That response is now in the spec as well, on every route declaring
a `request` schema, referencing a shared `ValidationError` component — the body the server
sends and the body the spec promises come from one Zod schema, so they cannot drift apart. A
route that declares its own 400 keeps it; `spec: { validationErrors: false }` turns the whole
thing off.

### Declaring authentication

Routes can say what they require, so the spec carries `securitySchemes`, the docs get an
"Authorize" button, and the SDK's consumers can see it:

```ts
// sdkgen.config.ts
spec: {
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  security: [{ bearer: [] }], // document-wide default
}

// a route that opts out
createRoute(router, { /* … */ security: [], handler });
```

This is declaration only — sdkgen does not issue or verify tokens.

### Nested routers

`createRoute` records the literal path you pass it — it can't see where a router is later
mounted. For routers mounted under a prefix, use a prefix-aware `router` so the registry gets
the fully-qualified path while Express still routes by the local path:

```ts
import { router } from '@kasdovel/express-sdkgen-core';

const accounts = router('/accounts');
accounts.route({
  method: 'get',
  path: '/',
  operationId: 'listAccounts',
  responses: { 200: AccountList },
  handler,
});

const admins = accounts.router('/admins'); // nested router, mounted under /admins
admins.route({
  method: 'get',
  path: '/:id',
  operationId: 'getAdmin',
  request: { params: IdParam },
  responses: { 200: Admin },
  handler,
});

accounts.mount(app); // mounts the /accounts router (and its /admins sub-router)
// spec paths: /accounts and /accounts/admins/{id}
```

Routers nest to any depth; the prefix is written once per level. The raw Express router is
hidden — mount with `.mount(app)`. Plain `createRoute` is the special case of a router at the
app root, so a root-mounted router needs no `router(...)` wrapper.

### Live docs in your own app

```ts
import { registry, serveDocs } from '@kasdovel/express-sdkgen-core';
await serveDocs(app, { registry, title: 'My API', version: '1.0.0', path: '/docs' });
```

## Development

```bash
pnpm install
pnpm build        # turbo: build core then cli
pnpm test         # all package + example tests
```

`pnpm test` works from a clean clone: turbo builds the packages and regenerates the example's
SDK (`gen`) before anything compiles against it.

See [`examples/api`](examples/api) for a complete working app and its e2e test.
