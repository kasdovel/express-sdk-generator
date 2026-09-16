---
'@kasdovel/express-sdkgen-core': minor
'@kasdovel/express-sdkgen-cli': minor
---

Close the gaps the review left open: make zero-drift enforceable, and stop the generated
artifacts from quietly saying less than they know.

**`sdkgen check`** regenerates every configured artifact into a temporary directory and fails
when it differs from what is committed, so a route change that was never regenerated cannot
reach your default branch. `sdkgen gen --watch` regenerates as you edit, `sdkgen init`
scaffolds the config and the side-effect-free entry, and `sdkgen serve` now reloads on change
instead of re-importing the entry on every request.

**The 400 that request validation already answers with is in the spec.** `ValidationErrorSchema`
is its single definition — `validate.ts` builds its payload as that type and `document.ts`
registers the same schema as a shared `ValidationError` component, so what the server sends and
what the spec promises cannot diverge without breaking the compile. Routes keep a 400 they
declare themselves; `spec.validationErrors: false` opts out. A user schema tagged
`.openapi('ValidationError')` is now rejected instead of silently taking the component name.

**`res.valid(status, payload)`** validates a response against the schema its route declares
before sending it, typed from the `responses` map so an undeclared status or a wrong shape is a
compile error. On outside production, overridable per route; `res.json` is untouched.

**Generated SDKs carry what they know.** Declared error bodies are emitted and
`isApiError(err, 404)` narrows `err.body` to that status's shape; a `…WithResponse` sibling
returns `{ status, headers, data }`; `sdk.validateRequests` parses arguments before sending;
repeated shapes hoist into shared consts (a `$ref`ed schema keeps its component name); `$ref`
cycles round-trip through `z.lazy()` instead of collapsing to `z.any()`; the missing
numeric/array keywords are covered, and anything unrepresentable leaves a
`// sdkgen: unsupported …` comment in the output rather than vanishing.

Routes can declare `security`, and `spec.securitySchemes` reaches the document. 205 and 304 join
204 as bodyless, HEAD responses are no longer parsed as JSON, and `spec.yamlOut` names the YAML
copy explicitly. Core re-exports `extendZodWithOpenApi` so `.openapi('Name')` needs nothing but
this package.
