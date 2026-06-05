import { z } from 'zod';
import {
  idSchema,
  isoDateTimeSchema,
  handleSchema,
  displayNameSchema,
  emailSchema,
} from './primitives';

/** Full user (the `/me` shape and the `user` inside auth responses). */
export const userSchema = z.object({
  id: idSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
  email: emailSchema,
  createdAt: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

/** Public projection of a user (search results, match participants) — no email. */
export const publicUserSchema = z.object({
  id: idSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;
