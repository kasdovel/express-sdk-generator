---
'@kasdovel/express-sdkgen-core': minor
'@kasdovel/express-sdkgen-cli': minor
---

Fail loudly where the toolchain used to drift silently, and fix two SDK runtime failure modes.

Core registration now rejects, with an actionable message:

- an `operationId` that is not a valid JavaScript identifier (it becomes an SDK method name);
- a second operation on the same method + path (OpenAPI keys operations by path + method, so
  the first silently vanished from the spec and SDK);
- a `:param` in the path that `request.params` does not declare — previously the spec carried
  no parameter and the generated client requested `/users/undefined`.

Generated SDK runtime:

- a non-2xx response whose body is not JSON (a proxy's HTML error page) now raises
  `ApiError(status, body)` instead of a `SyntaxError` from `JSON.parse`;
- a missing path parameter throws `Missing path parameter "id" …` instead of building a URL
  containing `undefined`;
- requests send `accept: application/json` by default (overridable per client or per call).

`serveDocs` now builds the document per request instead of snapshotting it at mount time, so
routes registered after the call (a router mounted later, a lazily-imported feature module) no
longer go missing from the live docs.

CLI:

- `gen docs` / `gen sdk` no longer rewrite `openapi.json` as a side effect, and asking for an
  artifact the config has no section for is an error rather than a silent no-op;
- `serve` failures (bad config path, invalid `--port`) print one line and exit 1 instead of
  surfacing as an unhandled rejection; `SDKGEN_DEBUG=1` restores stack traces;
- emitted SDK files carry an `@generated` banner and an eslint pragma;
- an `operationId` that would shadow a `BaseClient` member is rejected at generation time;
- configured titles are HTML-escaped in the generated docs page;
- a YAML `spec.out` combined with `spec.yaml: true` (whose outputs would collide) is now an
  explicit error instead of writing `openapi.yaml.yaml`.

The `sdkgen` bin now points at a committed launcher stub, so package managers can always
create the `node_modules/.bin/sdkgen` link at install time.
