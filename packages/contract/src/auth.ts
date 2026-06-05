import { z } from 'zod';
import { emailSchema, passwordSchema, displayNameSchema, handleSchema } from './primitives';
import { userSchema } from './user';

/** C1 — POST /v1/auth/register */
export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  handle: handleSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** C2 — POST /v1/auth/login */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Shared response for register (201) and login (200). */
export const authResponseSchema = z.object({
  token: z.string().min(1),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
