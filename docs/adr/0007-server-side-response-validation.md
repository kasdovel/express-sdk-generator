# `res.valid` validates a response before it is sent

The generated SDK parses every response through the operation's schema, so Drift throws — but
it throws in the _consumer's_ process, which is the last place anyone wants to discover it. The
server, which is where the drift originates and where the tests live, had no way to notice that
`res.json(user)` no longer matched the `User` it promised.

We add `res.valid(status, payload)`, installed per request by `registerRoute` alongside the
existing request-validation middleware. It parses the payload through the schema the route
declares for that status and sends the _parsed_ value, so declared defaults and transforms
reach the wire exactly as the Spec promises. A mismatch raises `ResponseValidationError` and an
undeclared status raises `UndeclaredResponseError`, both through `next(err)` so they surface at
the app's error handler — which is how they appear in the API's own test suite.

The types come from a generic `R` on `CreateRouteConfig`, carrying the `responses` object
literal through `createRoute`, `registerRoute` and `ApiRouter.route`. The status argument is
narrowed to the codes the route declares and the payload to that status's input type, so an
undeclared status or a wrong shape fails to compile as well as at runtime.

Validation runs when `NODE_ENV !== 'production'`, overridable per route with
`validateResponses`. `NODE_ENV` is read per response rather than at registration, so an app
that imports its routes before loading env config still behaves correctly.

## Considered Options

- **Wrap or patch `res.json` globally** so every response is checked with no new API. Rejected:
  it changes the meaning of a method the user did not opt into, and it has no answer for a
  handler legitimately sending something the route does not declare (a framework error page, a
  redirect body). `res.valid` is additive — `res.json` still does exactly what Express says.
- **Middleware over the serialized body.** Would catch responses sent by any means, but it can
  only inspect bytes after the fact, so it cannot send the parsed value, cannot narrow types,
  and reports failures too late to turn into a useful stack.
- **Always-on validation.** Simplest to explain, but it puts a Zod parse next to every JSON
  encode in production for a class of bug that is almost always caught in development. Default
  off in production, with an explicit override, keeps the cost where the value is.

## Consequences

- `createRoute` now carries a fifth generic. It defaults to `Record<number, ResponseInput>`, so
  untyped call sites keep working — `keyof R` degrades to `number` rather than erroring.
- Two ways to send a response coexist. The invariant to teach: `res.valid` for a declared
  response, `res.json` for anything outside the contract.
- 204, 205 and 304 are `.end()`ed with no body, sharing one `BODYLESS_STATUSES` constant with
  `document.ts` so the runtime and the Spec cannot disagree about which statuses carry a body.
