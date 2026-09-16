import { z } from 'zod';
import { extendZodWithOpenApi } from '@kasdovel/express-sdkgen-core';

// Adds `.openapi()` to Zod (types included).
extendZodWithOpenApi(z);

// `.openapi('Name')` gives the schema a component name, so the spec emits a
// `$ref` and the generated SDK exports one readable `User` instead of inlining
// the same shape at every operation that returns it.
export const User = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
  })
  .openapi('User');

export const CreateUser = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
  })
  .openapi('CreateUser');

export const ErrorBody = z
  .object({
    error: z.string(),
  })
  .openapi('ErrorBody');

export const IdParam = z.object({
  id: z.string(),
});

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const UserList = z.array(User).openapi('UserList');
