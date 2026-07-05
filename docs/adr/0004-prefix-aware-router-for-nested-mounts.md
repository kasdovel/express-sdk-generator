# Prefix-aware Router for nested mounts

`createRoute` records the literal `path` it is given and cannot see where the Express router
it registers on will later be mounted ([ADR-0001](0001-schema-first-zod-via-createroute.md)).
That is correct only when the router sits at the app root — the moment a router is mounted
under a prefix (`parent.use('/admins', child)`), the app still routes correctly but the
registry, spec, and SDK record the un-prefixed path. The result: nested routers silently
produce wrong URLs in the generated artifacts.

We introduce a **prefix-aware Router** (`router(prefix)` → `ApiRouter`). It owns its Express
router and knows its mount prefix, so `.route(...)` registers the _local_ path on Express
(mounting composes normally) while recording the _full_ accumulated path in the registry.
Routers nest via `.router(subPrefix)`, which mounts the child and accumulates the prefix.
The raw Express router is hidden behind `.mount(parent)`. `createRoute` is kept as sugar for
the root case (a router mounted at `/`), which is the one case where local and full paths
coincide.

## Considered Options

- **Walk `app._router.stack` at generation time** to recover real mount paths. Recovers
  prefixes with no user effort, but depends on Express private internals (brittle across
  Express 4/5) and requires a booted app — defeating the side-effect-free jiti-import model
  ([ADR-0002](0002-sdk-from-registry-not-openapi-codegen.md)).
- **Require the full path in every `createRoute` call** regardless of mounting. No new
  concept, but the prefix is repeated per route and trivially desyncs from the actual
  `.use()` mount path.

### Naming

The concept was prototyped as `group`, then weighed against `scope`, `resource`, and
`router`. We chose **router**: it is the truthful name (the thing _is_ an Express router plus
a known prefix) and matches the mental model that every router is mounted somewhere, the root
at `/`. `resource` was rejected because it lies for non-resource prefixes (`/v1`,
`/internal`); `scope`/`group` are vaguer. To blunt the clash with `express.Router`, the
factory is lowercase `router()` and the exported type is `ApiRouter`.

## Consequences

- Two ways to declare routes coexist: `createRoute` (root case) and `router(...).route(...)`
  (anything mounted under a prefix). The invariant to teach: if a router is mounted under a
  prefix, declare it with `router`, not `createRoute`.
- `ApiRouter` shares the registration core (`registerRoute`) with `createRoute`; the only
  difference is the registry path passed in.
