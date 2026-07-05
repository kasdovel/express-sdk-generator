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

**Router**:
A prefix-aware container that owns an Express router mounted at a known path. Routes added
to it are recorded under the full accumulated path; Routers nest. This is what keeps spec
and SDK paths correct when a router is mounted under a prefix. Distinct from a raw
`express.Router`, which is unaware of where it will be mounted.
_Avoid_: Group, scope, namespace

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

**Transport**:
A strategy the SDK consumer supplies to control how a request is carried to the server and
back — it reports the response's status and parsed data, not raw bytes. Selectable per HTTP
method, with a client-wide default. A Transport changes _delivery_ (which HTTP mechanism,
caching, retry), never _meaning_: the SDK still validates every response and still turns a
non-2xx status into the failure it raises. A Transport reports HTTP error statuses as data;
only a true network failure throws out of it.
_Avoid_: Fetcher, adapter, client, driver
