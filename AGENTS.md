# AGENTS.md

This file provides guidance to AI Coding Assistants/Agents when working with code in this repository.

## What this is

`sdkgen` generates an OpenAPI spec, Swagger/Redoc docs, and a typed TypeScript SDK from an
Express + TypeScript app. The design constraint is **zero drift**: a user declares Zod
schemas once per route via `createRoute`, and that single declaration drives runtime request
validation, the spec, the docs, and the SDK. Read `CONTEXT-MAP.md` for the canonical glossary
and `docs/adr/` for the decisions that shape everything.

## Commands

```bash
pnpm install
pnpm build            # turbo: builds @kasdovel/express-sdkgen-core then @kasdovel/express-sdkgen-cli (tsup, esm+cjs+dts)
pnpm test             # turbo: all package + example tests (vitest)
pnpm typecheck        # turbo: tsc --noEmit across packages

# Scope to one package
pnpm --filter @kasdovel/express-sdkgen-core build
pnpm --filter @example/api typecheck

# Run a single test file / single test
pnpm --filter @kasdovel/express-sdkgen-core exec vitest run test/core.test.ts
pnpm --filter @example/api exec vitest run -t "404"

# Run the generator against the example app, then preview
pnpm --filter @example/api gen          # = sdkgen gen all
pnpm --filter @example/api exec sdkgen gen spec   # one artifact only
pnpm --filter @example/api dev          # boot example on :3000, docs at /docs
```

Turbo caches `build`/`test`/`typecheck`. After editing `core`, rebuild before the CLI or the
example will use stale `dist/` — `pnpm build` handles the ordering (`core#build` before
`cli#build`).

## Architecture

Two published packages plus an example, split by **when code runs** (see ADR-0003):

- **`@kasdovel/express-sdkgen-core`** — runtime, a _production_ dependency of the user's app.
- **`@kasdovel/express-sdkgen-cli`** — the `sdkgen` generator, a _devDependency_. Depends on `core`; the arrow
  never points back.

The data flow is a single pipeline, all keyed off one in-memory **Registry**:

```
user calls createRoute(router, {...})          [core/createRoute.ts]
   ├─ registers Express handler + validation middleware   [core/validate.ts]
   ├─ types the handler so req.valid.{params,query,body} infer
   └─ pushes a RouteDef (with live Zod schemas) into the Registry  [core/registry.ts]

CLI loads the user's side-effect-free Entry via jiti  [cli/load.ts]
   → Registry is now populated
   → buildDocument(registry)  [core/document.ts]  → OpenAPI doc (canonical artifact)
        ├─ emitSpec  → openapi.json / .yaml
        ├─ emitDocs  → Swagger/Redoc HTML (spec always inlined; UI from CDN, or
        │              vendored inline when `docs.offline`)
        └─ emitSdk   → typed client (see below)
```

Key invariants to preserve when editing:

- **The Registry holds live Zod objects, not serialized schemas.** This is deliberate
  (ADR-0001/0002) — it's what lets `core/document.ts` feed real schemas to
  `@asteasolutions/zod-to-openapi`. `extendZodWithOpenApi(z)` is called once in
  `document.ts`; it patches the shared zod prototype, so a single zod instance across the
  workspace matters.
- **Parsed request data goes on `req.valid`, never by reassigning `req.query`.** Express 5
  makes `req.query` a getter; `validate.ts` writes to `req.valid.{params,query,body,headers}`
  and the typed handler reads from there.
- **The Entry must be side-effect-free** (no `app.listen`, no DB connect). The CLI imports it
  in-process via jiti. The example's pattern: `src/openapi.ts` imports `./routes.js` (to
  populate the global registry) then re-exports `registry` from `@kasdovel/express-sdkgen-core`.
- **`createRoute` records the literal path; it can't see mount prefixes.** For a router
  mounted under a prefix, use the prefix-aware `router(prefix)` (`core/router.ts`, type
  `ApiRouter`) so the registry gets the full path while Express routes by the local path —
  otherwise nested routers emit wrong URLs in the spec/SDK. `createRoute` is the root-mount
  special case. Both share `registerRoute` in `core/createRoute.ts` (see ADR-0004).

### SDK generation (the non-obvious part)

The SDK is generated **from the registry/document, not by running a standard OpenAPI codegen**
(ADR-0002). `cli/emitSdk.ts` walks the generated document's operations and emits:

- `schemas.ts` — standalone Zod, produced by `cli/jsonSchemaToZod.ts` from the document's JSON
  Schemas. This is what makes the SDK self-contained and able to validate responses without
  importing app code.
- `runtime.ts` — copied verbatim from `cli/sdkRuntime.ts` (a string template). Contains
  `BaseClient`, the `Transport` abstraction, and `ApiError`. A `Transport` is a per-method
  (with client-wide default) async fn returning `{ status, data }`; `BaseClient` still owns
  header merge, `content-type`, status→`ApiError`, and response validation, so a `Transport`
  swaps _delivery_ only and never bypasses zero-drift (ADR-0005). Default transport is global
  `fetch`.
- `client.ts` — one method per operationId; **always** parses the response through the
  operation's Zod schema before returning, so server/SDK drift throws.

`jsonSchemaToZod.ts` covers the structural subset (objects, arrays, primitives, enums, unions,
`$ref`, nullability, string formats). Zod refinements/transforms do not round-trip through
JSON Schema — that's an accepted limitation, not a bug.

## Conventions

- TS source uses `.js` import specifiers (NodeNext-style); keep this for jiti/ESM resolution.
- Exported bindings that infer Express types (e.g. a `Router`) need explicit annotations
  (`export const router: Router = Router()`) or `tsc` emits TS2742 portability errors.
- The example app (`examples/api`) is the end-to-end fixture — its `vitest` boots the app on
  an ephemeral port, drives the generated SDK, and asserts typed responses, 404→`ApiError`,
  400 from request validation, and response-drift→`ZodError`. Treat it as the integration
  contract: changes to generation should keep it green.

## Agent skills

### Issue tracker

Issues are tracked on GitHub via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage is configured with default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a multi-context layout mapped by a root `CONTEXT-MAP.md`. See `docs/agents/domain.md`.
