# SDK generated from the registry, not via a standard OpenAPI codegen

The obvious path is to emit the OpenAPI spec and run an existing codegen
(`openapi-typescript`, `orval`) over it. We instead treat the **Registry as the single
source of truth** and generate both the spec and the SDK from it directly (hybrid): the
spec is the canonical published artifact, but the SDK's own response-validation schemas are
generated from the document's JSON Schemas into standalone Zod, so the SDK validates every
response with no coupling to the user's app source.

A future reader will reasonably ask "why not just pipe the spec into openapi-typescript?" —
hence this record.

## Considered Options

- **`openapi-typescript`/`orval` over the emitted spec** — less code to own and standard
  output, but adds a heavy dependency, an extra indirection, and produces types-only clients
  (no runtime response validation), which defeats the always-validate goal.

## Consequences

- We own a focused JSON-Schema→Zod emitter (`jsonSchemaToZod.ts`). It covers the structural
  subset (objects, arrays, primitives, enums, unions, refs, nullability, formats); Zod
  refinements/transforms do not round-trip through JSON Schema. Structural validation is the
  goal — it catches server/SDK drift.
- The generated SDK ships its own Zod schemas and is fully standalone (no import of app code).
