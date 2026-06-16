# Two-package split: `@sdkgen/core` (runtime) and `@sdkgen/cli` (generator)

The runtime helpers (`createRoute`, Registry, request validation, `serveDocs`) run inside
the user's app and are a production dependency. The generator only reads the Registry and
emits files, so it is a devDependency. We split these into two packages rather than one bin
that exposes both, so the app's production bundle never drags in the codegen, jiti, or CLI
machinery. The boundary: anything imported at request time lives in `core`; anything that
only runs at build time lives in `cli`.

## Consequences

- A monorepo (pnpm workspaces + Turborepo) is required to build and link the two together;
  `core` builds before `cli`.
- `cli` depends on `core` (to reuse `buildDocument`), not the reverse — the dependency arrow
  points from build-time toward runtime, never back.
