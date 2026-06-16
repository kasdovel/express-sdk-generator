import { z } from "zod";

export const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

export const CreateUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const ErrorBody = z.object({
  error: z.string(),
});

export const IdParam = z.object({
  id: z.string(),
});

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const UserList = z.array(User);
