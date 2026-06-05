import { z } from 'zod';
import { userSchema, publicUserSchema } from './user';

/** C3 — GET /v1/me */
export const meResponseSchema = userSchema;
export type MeResponse = z.infer<typeof meResponseSchema>;

/** C4 — GET /v1/users?handle=iva — prefix search by handle. */
export const userSearchQuerySchema = z.object({
  handle: z.string().trim().min(1).max(20),
});
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;

export const userSearchResponseSchema = z.object({
  users: z.array(publicUserSchema),
});
export type UserSearchResponse = z.infer<typeof userSearchResponseSchema>;
