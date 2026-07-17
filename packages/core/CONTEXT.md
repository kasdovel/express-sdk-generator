# Core Runtime Glossary

Domain glossary for the core runtime package (`@kasdovel/express-sdkgen-core`).

## Language

**Route**:
A single HTTP endpoint declared with `createRoute` — its method, path, request schemas, and response schemas. The unit a user writes.
_Avoid_: Endpoint, handler, path

**Router**:
A prefix-aware container that owns an Express router mounted at a known path. Routes added to it are recorded under the full accumulated path; Routers nest. This is what keeps spec and SDK paths correct when a router is mounted under a prefix. Distinct from a raw `express.Router`, which is unaware of where it will be mounted.
_Avoid_: Group, scope, namespace

**Registry**:
The in-memory collection of Routes, holding the real Zod schemas. The single source of truth every Artifact is generated from.
_Avoid_: Store, catalog, collection

**Transport**:
A strategy the SDK consumer supplies to control how a request is carried to the server and back — it reports the response's status and parsed data, not raw bytes. Selectable per HTTP method, with a client-wide default. A Transport changes _delivery_ (which HTTP mechanism, caching, retry), never _meaning_: the SDK still validates every response and still turns a non-2xx status into the failure it raises. A Transport reports HTTP error statuses as data; only a true network failure throws out of it.
_Avoid_: Fetcher, adapter, client, driver
