import { z } from 'zod';

/**
 * The name the shared component is registered under in the generated document
 * (`#/components/schemas/ValidationError`).
 */
export const VALIDATION_ERROR_SCHEMA_NAME = 'ValidationError';

/**
 * One Zod issue as it appears on the wire. Only the three fields every issue
 * carries are declared: Zod adds code-specific extras (`expected`, `received`,
 * `unionErrors`, …) that differ per issue, and describing them all in JSON
 * Schema would be a large union that tells a consumer nothing useful. The extras
 * are still sent — OpenAPI objects allow additional properties by default.
 */
const ValidationIssue = z.object({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/**
 * The 400 body that `validate.ts` answers with when a request fails the schemas
 * declared for its route.
 *
 * This is the *single* definition of that shape. `validate.ts`'s default
 * `onError` builds its payload as a `ValidationErrorBody`, so `tsc` rejects any
 * divergence, and `document.ts` registers this same schema as the shared
 * `#/components/schemas/ValidationError` component. Neither the response the
 * server sends nor the response the spec promises can move without the other —
 * which is the guarantee the whole library exists to give, applied to its own
 * output.
 */
export const ValidationErrorSchema = z.object({
  error: z.literal(VALIDATION_ERROR_SCHEMA_NAME),
  part: z.enum(['params', 'query', 'body', 'headers']),
  issues: z.array(ValidationIssue),
});

/** The body shape of a 400 produced by request validation. */
export type ValidationErrorBody = z.infer<typeof ValidationErrorSchema>;
