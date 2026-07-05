# Per-method Transport for the generated SDK

The generated SDK ships one built-in way to reach the server: `BaseClient.request` builds the
URL, calls a `fetch`-shaped function, reads the response as text, `JSON.parse`s it, and
finally validates it against the operation's response schema. A consumer could swap the whole
transport via a single `fetch` option, but that option was `fetch`-shaped in the literal sense
— it returned `{ ok, status, text() }`. Two things forced a rethink:

- Consumers wanted to choose the HTTP mechanism **per method** — e.g. a caching or custom
  fetcher for `GET`, plain `fetch` for the rest.
- Real HTTP clients (axios and friends) already hand back **parsed JSON**, not text. The old
  contract made them re-serialize their parsed body to text only so the SDK could parse it
  again. The `text()` envelope leaked a raw-`fetch` assumption.

We introduce a **Transport** (see [CONTEXT.md](../../CONTEXT.md)): a strategy the consumer
supplies to carry one request and report the response as `{ status, data }`, where `data` is
already parsed. Transports are selectable per HTTP method with a client-wide default, resolved
per-method → default → the built-in `fetch` adapter. This replaces the old `fetch` /
`FetchLike` option outright (the SDK is young enough that a clean break beats carrying two
transport shapes).

```ts
interface TransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}
interface TransportResponse {
  status: number;
  data: unknown;
}
type Transport = (req: TransportRequest) => Promise<TransportResponse>;
```

The decisive constraint: **a Transport changes delivery, never meaning.** The SDK keeps
ownership of everything that guards against Drift ([ADR-0002](0002-sdk-from-registry-not-openapi-codegen.md)):
it merges headers and sets `content-type`, it decides success (`status` in `200–299`, else it
raises `ApiError(status, data)`), and it still runs `responseSchema.parse(data)` on every
response. A Transport only decides _how bytes travel_ and _how the body is deserialized_. Body
serialization moves into the Transport (the built-in adapter `JSON.stringify`s; axios takes the
object as-is), because that is the one part that genuinely differs between HTTP clients.

Two contract rules that a future reader will otherwise trip over:

- **A Transport must not throw on an HTTP error status.** It resolves with `{ status, data }`
  for 4xx/5xx just as for 2xx; the SDK turns the status into the failure. Only a true network
  failure (DNS, timeout, connection reset) throws out of a Transport and propagates raw. This
  matters most for axios, which _rejects_ on non-2xx by default — an axios Transport must set
  `validateStatus: () => true`.
- **Error bodies are not schema-validated.** `ApiError.body` carries the server's parsed error
  payload as `unknown`; the consumer branches on `status` and reads `body`. Typing error
  responses is a separate, larger feature and is deliberately out of scope here.

## Considered Options

- **Keep the `fetch`-shaped `{ ok, status, text() }` transport, add a per-method map of the
  same shape.** Smallest change, but preserves the text round-trip that made axios/custom
  clients awkward, and keeps `ok` as a redundant field a Transport author can compute
  inconsistently (`status < 300` vs the real `200–299`). Rejected.
- **Let the Transport return `T` directly and skip response validation for overridden
  methods.** Maximum flexibility, but it discards the one invariant the whole project exists
  to guarantee — zero Drift — for exactly the requests a consumer customises. Rejected on
  principle.
- **Keep `ok` in `TransportResponse` alongside `status`.** Redundant (derivable from
  `status`) and a source of threshold drift between Transports. Dropped in favour of the SDK
  owning the 2xx decision centrally.

## Consequences

- The change is confined to the SDK runtime template (`cli/sdkRuntime.ts`); the operation
  codegen in `cli/emitSdk.ts` is untouched, since generated methods still call
  `this.request(...)` unchanged.
- `signal` now reaches the Transport. Previously `RequestOptions.signal` was declared but
  silently dropped before the `fetch` call; forwarding it into `TransportRequest` fixes that
  dead option. Both `signal` fields are typed `AbortSignal`, which assumes the consumer's
  tsconfig includes the DOM/Node lib — true for essentially all SDK consumers, and worth the
  proper typing over the previous `unknown`.
- Consumers who passed `fetch` in `ClientOptions` must migrate to `transport` (or a
  per-method entry in `transports`). The built-in default still uses global `fetch`, so
  consumers who passed nothing are unaffected.
