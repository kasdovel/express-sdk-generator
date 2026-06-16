# Schema-first with Zod via a `createRoute` registry

Express exposes paths and methods at runtime but not request/response *types*, so any
generator must get schemas from somewhere. We chose **schema-first with Zod**: the user
declares Zod schemas once per route through a `createRoute` helper that, in one call,
registers the Express handler, installs request validation, and records the schemas in a
Registry. That single declaration is the source for runtime validation, the OpenAPI spec,
the docs, and the SDK — making drift between them structurally impossible.

## Considered Options

- **Decorator-based** (tsoa/routing-controllers) — forces a class-based controller rewrite.
- **JSDoc comments** (swagger-jsdoc) — zero type safety, comment/code drift.
- **Static TS inference** — parse handler signatures; brittle on generics, unions, and
  middleware-injected properties.
- **Runtime introspection only** — yields paths with empty schemas.

Zod won because it gives types, runtime validation, and OpenAPI from one object, and Zod
schemas are what the SDK generator already needs.

## Consequences

- Users must adopt the `createRoute` helper rather than registering routes on Express
  directly. This is the intended cost of the no-drift guarantee.
- The Registry holds live Zod objects (not a serialized form), which is what lets schema
  refinements survive into generation. See [ADR-0002](0002-sdk-from-registry-not-openapi-codegen.md).
