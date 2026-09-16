# Code review: product and DX

Date: 2026-09-16 · Scope: whole repository at `affa0be`

`sdkgen` is a small, coherent codebase (~2.2k lines of source) with an unusually clear
thesis: one Zod declaration per route drives validation, spec, docs, and SDK, so drift is
structurally impossible. The ADRs, `CONTEXT-MAP.md`, and `AGENTS.md` are genuinely good —
the reasoning behind the two-package split, the registry-over-codegen choice, and the
Transport abstraction is all written down and matches the code.

This review sorts findings by how much they cost a user, and separates **what was fixed in
this pass** from **what is recommended next**.

---

## 1. Fixed in this pass

Each of these was a case where the toolchain produced something wrong or confusing without
saying so — the opposite of the product's promise.

### 1.1 Silent spec drift at registration (core)

| Problem                                                           | Was                                                                                                | Now                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A `:param` in the path with no matching `request.params` key      | No `parameters` in the spec; SDK method takes no `params`; requests `/users/undefined`             | Error at `createRoute`, naming the parameter and the fix |
| Two operations on the same method + path                          | Second silently replaced the first in the document; first vanished from the SDK                    | Error naming both operationIds                           |
| An `operationId` that is not a JS identifier (`get-user`)         | Emitted syntactically invalid `client.ts`; failure surfaced as a `tsc` error in the user's project | Error at registration                                    |
| An `operationId` colliding with a `BaseClient` member (`request`) | Generated class shadowed its own transport plumbing                                                | Error at generation, suggests a rename                   |

The first one is the most valuable: `pathParamNames()` already existed in `core/path.ts` and
was exported but never used. It is now the guard it was evidently written to be.

### 1.2 Generated SDK runtime

- **Non-JSON error bodies.** `fetchTransport` ran `JSON.parse` on every body. A gateway
  returning an HTML 502 surfaced as `SyntaxError: Unexpected token '<'`, not `ApiError(502)` —
  breaking the documented contract that every non-2xx becomes an `ApiError`. Body parsing now
  falls back to raw text.
- **Missing path parameters.** `String(args.params?.[key])` produced the literal string
  `undefined` in the URL. Now throws `Missing path parameter "id" for GET /users/{id}`.
- **`accept: application/json`** is sent by default (overridable per client or per call).

### 1.3 CLI behaviour

- `gen docs` and `gen sdk` rewrote `openapi.json` as a side effect. The document is still
  always built in memory (docs and SDK derive from it), but only written when asked for.
- Requesting an artifact the config has no section for was a silent no-op printing only the
  spec path. It is now an error; `gen all` stays permissive.
- `serve` failures escaped `parseAsync` as unhandled rejections with a raw stack. All CLI
  failures now print one `✗` line and exit 1; `SDKGEN_DEBUG=1` restores stacks.
- Emitted files carry `/* eslint-disable */` and an `@generated` banner, so the SDK does not
  land in the consuming project's lint report and reads as build output in review.
- Configured titles are HTML-escaped in the generated docs page and the `serve` preview.

### 1.4 `serveDocs` snapshotted the registry

The document was built once, at mount time. `await serveDocs(app, …)` before the routers are
mounted — a natural reading order — produced permanently empty docs. It now builds per
request. This is also the first test coverage `serveDocs` has had.

### 1.5 Repository bootstrap

Two papercuts that hit every new contributor on their first command:

- `pnpm test` failed on a clean clone with `Failed to load url ../sdk/index.js`, because
  nothing generated the example's SDK. CI worked around it with a hand-written
  `node ../../packages/cli/dist/bin.js gen all` step. Turbo now has a `gen` task that
  `test`/`typecheck`/`lint` depend on, and the CI workaround is gone.
- `pnpm --filter @example/api gen` — documented in `AGENTS.md` — failed with
  `sdkgen: not found`. `bin` pointed at `dist/bin.js`, which does not exist at install time,
  so pnpm could not create the `.bin` link (it warns and continues). `bin` now points at a
  committed stub, `packages/cli/bin/sdkgen.mjs`, that forwards to the build output and prints
  a clear message if it is missing.
- `pnpm verify-publish` existed but nothing ran it. It is now a CI step.

---

## 2. Recommended next, in priority order

### 2.1 `sdkgen check` — make zero-drift enforceable (highest value)

The product's claim is "no drift", but nothing stops a user from editing a route and
committing without regenerating. A `check` subcommand — regenerate into memory, diff against
the committed artifacts, exit non-zero on a difference — turns the promise into a CI gate:

```yaml
- run: npx sdkgen check # fails if openapi.json / sdk/ are stale
```

This is a small amount of code (the generators already return their output) with an outsized
effect on the product's core claim.

### 2.2 The 400 validation response is invented at runtime and absent from the spec

`createRoute` installs middleware that can always answer `400 { error: 'ValidationError',
part, issues }`, but that response only appears in the spec if the user hand-writes
`400: ErrorBody` — and then its shape is whatever they happened to type. That is exactly the
drift the library exists to remove, in the library's own output.

Suggested: when a route declares any `request` schema, `buildDocument` adds a documented 400
response referencing a shared `ValidationError` component (opt out via config for teams with
their own error envelope). The generated SDK can then type `ApiError.body` for that status.

### 2.3 Declared error responses never reach the SDK

Routes declare `404: ErrorBody`, `409: Conflict` — `emitSdk.pickResponseSchema` keeps only the
first 2xx and discards the rest, so `ApiError.body` is `unknown` and consumers hand-cast.
Suggested: emit the error schemas too and give the runtime a narrowing helper:

```ts
try {
  await api.getUser({ params: { id } });
} catch (err) {
  if (isApiError(err, 404)) err.body.error; // typed from the route's 404 schema
}
```

### 2.4 No access to status or headers on success

`BaseClient.request` returns only the parsed body, so pagination headers, `ETag`, and
rate-limit headers are unreachable without replacing the Transport. Suggested: a per-call
`{ raw: true }` (or a generated `…WithResponse()` sibling) returning `{ status, headers, data }`,
keeping the current signature as the default.

### 2.5 Everything is inlined; nothing is named

`zod-to-openapi` only emits `components.schemas` entries for schemas tagged with `.openapi('Name')`.
Nothing in the README mentions this, so the example's `User` shape appears four times in the
generated `schemas.ts` and there are no reusable types in the SDK. Suggested: document
`.openapi()` prominently, and/or dedupe structurally identical schemas in `emitSdk` into
shared consts.

### 2.6 `jsonSchemaToZod` degrades silently

- A `$ref` cycle returns `z.any()` — a self-referential `Category` loses **all** validation,
  quietly. `z.lazy()` with named consts would round-trip it.
- Unhandled keywords: `exclusiveMinimum`/`exclusiveMaximum`, `multipleOf`, `minItems`/`maxItems`,
  `uniqueItems`, `additionalProperties` defaults.

Each gap weakens the response validation the SDK exists to provide. At minimum, emit a
`// sdkgen: unsupported keyword …` comment so the loss is visible in the diff rather than
invisible in production.

### 2.7 Request arguments are never validated client-side

`emitSdk` already writes `…Params`, `…Query`, and `…Body` schemas, and the client imports
none of them for validation — only for types. Types vanish at runtime, so a JS consumer, or
`any` sneaking through TS, sends whatever it likes and learns about it from a 400. An opt-in
`sdk: { validateRequests: true }` would close the loop, and defaults/coercions declared in the
route schemas would then apply client-side too.

### 2.8 Server responses are validated only by the client

Response drift throws in the _consumer's_ process, which is the last place you want to find
out. A dev-mode `res.valid(200, payload)` helper (or an opt-in wrapper that parses outgoing
bodies against the declared schema) would fail drift in the API's own test suite instead.

### 2.9 Authentication has no first-class story

`RouteDef` has no `security` field, so the spec never carries `securitySchemes`, the docs
offer no "Authorize" button, and SDK consumers thread `headers` by hand. A `security` entry
on the route plus `auth: { bearer: () => token }` on the client (allowing an async token
getter for refresh) would cover the common cases.

### 2.10 Developer loop

- `sdkgen gen --watch`: regenerate on entry-module changes. `jiti` already runs with
  `moduleCache: false`, so the hard part is done.
- `sdkgen init`: scaffold `sdkgen.config.ts` and a side-effect-free entry. The entry contract
  is the one concept every new user gets wrong, and a scaffold teaches it in one command.
- `serve` re-imports the whole entry on _every_ request, including the HTML page request —
  fine for the example, slow for a real app. Re-import on file change instead, and consider
  an SSE reload so the browser refreshes itself.

### 2.11 Smaller items

- `spec.out` doubling as "the JSON path" is implicit: with `out: 'api.yaml'` and `yaml: true`
  the two outputs used to collide into `api.yaml.yaml` (this pass makes it an explicit error,
  but an explicit `yamlOut` would read better than inferring one path from the other).
- `document.ts` omits the response body for 204 only; 205 and 304 are also bodyless.
- A `head` route that declares a response schema will always fail validation — HEAD has no
  body. Either skip response validation for HEAD or reject the declaration.
- Generated files are not run through Prettier, so `schemas.ts` has uneven indentation. Either
  format the output or tidy the emitters' string building.
- `.gitattributes` with `linguist-generated=true` for `examples/*/sdk/` would collapse the
  generated diff on GitHub.
- Peer range is `zod@^3.23`. Zod 4 changes the string-format API the emitted schemas use
  (`z.string().email()` → `z.email()`); worth planning a compatibility pass (and checking the
  current `@asteasolutions/zod-to-openapi` support matrix) before it becomes a support burden.

### 2.12 Test coverage gaps

`load.ts` (config resolution, jiti failures), `serve.ts`, `emitSpec`'s YAML path, and
`ApiRouter.mount` have no tests. The `validate` tests cover the body path only — not headers,
params, or a custom `onError`. There is no coverage threshold configured. Given how much of
this product is code-generation, a snapshot test over the generated `client.ts` /
`schemas.ts` for a fixture app would catch emitter regressions cheaply.

---

## 3. What is working well

- The pipeline is genuinely one-way and easy to follow: `Registry → document → {spec, docs, sdk}`.
  Every artifact derives from the same in-memory object.
- Keeping live Zod objects in the registry (ADR-0001/0002) is the right call and is what makes
  the SDK's response validation meaningful.
- The `Transport` abstraction (ADR-0005) is well-drawn: it swaps delivery without letting a
  consumer bypass validation or error mapping. The e2e tests for it are the best in the repo.
- `req.valid` instead of reassigning `req.query` is the correct Express 5 answer, and it is
  documented as an invariant rather than left as folklore.
- The example app doubles as the integration contract, and the docs offline mode is a thoughtful
  touch for air-gapped consumers.
