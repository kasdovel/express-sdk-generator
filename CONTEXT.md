# sdkgen

A tool that turns an Express + TypeScript app into an OpenAPI spec, docs, and a typed
TypeScript SDK from one Zod declaration per route — without drift between them.

## Language

**Route**:
A single HTTP endpoint declared with `createRoute` — its method, path, request schemas,
and response schemas. The unit a user writes.
_Avoid_: Endpoint, handler, path

**Operation**:
A Route as it appears in the generated OpenAPI document and SDK, identified by its
`operationId`. One Route becomes exactly one Operation.
_Avoid_: Method, action

**Registry**:
The in-memory collection of Routes, holding the real Zod schemas. The single source of
truth every Artifact is generated from.
_Avoid_: Store, catalog, collection

**Entry**:
The side-effect-free module a user exposes for the CLI to import (e.g. `src/openapi.ts`).
Importing it populates the Registry. Must never start a server.
_Avoid_: Main, index, bootstrap

**Artifact**:
A generated output: the Spec, the Docs, or the SDK. All three derive from the Registry.
_Avoid_: Output, build, target

**Spec**:
The OpenAPI document generated from the Registry. The canonical published description of
the API.
_Avoid_: Schema, swagger.json, definition

**SDK**:
The generated typed TypeScript client. Has one method per Operation and validates every
response against the Operation's response schema.
_Avoid_: Client library, bindings, stubs

**Drift**:
Any divergence between what the API actually does and what the Spec/SDK describe. The
design goal is structural impossibility of drift — one declaration feeds everything.
_Avoid_: Mismatch, skew, staleness
