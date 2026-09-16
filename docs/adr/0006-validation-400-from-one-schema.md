# The validation 400 is documented from a single schema

`createRoute` installs middleware that answers `400 { error: 'ValidationError', part, issues }`
whenever a request fails the Zod schemas declared for its route ([ADR-0001](0001-schema-first-zod-via-createroute.md)).
That response reached the wire but never the Spec: it appeared in the generated document only
if the user hand-wrote a `400` entry, and then with whatever shape they happened to type. A
library whose entire purpose is making Drift structurally impossible was shipping Drift in its
own output — the one response it generates itself was the one response it did not describe.

We make that body a single Zod schema, `ValidationErrorSchema` in `core/validationError.ts`,
and point both ends at it. `validate.ts`'s default `onError` builds its payload as a
`ValidationErrorBody`, so `tsc` rejects any divergence; `document.ts` registers the same schema
as a shared `#/components/schemas/ValidationError` component and attaches a 400 to every route
that declares a `request` schema. Neither the response the server sends nor the response the
Spec promises can move without the other.

A route that declares its own `400` keeps it — an explicit declaration always wins over a
generated one. The component is registered only when some route actually references it, so
APIs that need no validation keep a clean components section.

## Considered Options

- **Leave it to the user** (the status quo). Zero machinery, but it makes correct documentation
  a manual chore that must be repeated per route and re-checked whenever the error envelope
  changes — exactly the class of work this library exists to delete.
- **Opt-in rather than opt-out.** Safer for existing specs, but it means the default output is
  knowingly incomplete. We chose the opposite default: the middleware can always send this
  response, so leaving it out is a lie, and `validationErrors: false` is there for apps that
  replace `onError` with a different envelope.
- **Validate the outgoing 400 body against the schema at runtime.** Catches divergence too, but
  only on the error path and only once it has already shipped. Typing `onError`'s payload moves
  the same guarantee to build time for free; a test drives a real 400 over HTTP and parses it
  back through the schema to cover the runtime half.
- **A configurable component name.** Rejected as ceremony for a problem that is better refused
  than accommodated: a user schema tagged `.openapi('ValidationError')` used to silently take
  the name and leave that route documented with the wrong shape, so `buildDocument` now errors
  instead.

## Consequences

- `ValidationError` is public API. Renaming it or changing its shape is a breaking change for
  every consumer that has typed against the generated spec or SDK.
- Adding this changes the generated spec for every existing project with request schemas. The
  400 is additive and opt-out, but the diff is visible on first regeneration.
- `issues[]` is documented with `code`, `path` and `message` only. Zod sends code-specific
  extras (`expected`, `received`, `unionErrors`) that differ per issue; describing them all
  would be a large union that tells a consumer nothing. The extras still reach the wire, since
  OpenAPI objects permit additional properties.
