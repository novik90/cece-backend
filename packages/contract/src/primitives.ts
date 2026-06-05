import { z } from 'zod';

/** Resource id (uuid/cuid) — opaque non-empty string. */
export const idSchema = z.string().min(1);

/** ISO-8601 UTC timestamp. */
export const isoDateTimeSchema = z.string().datetime();

/**
 * Unique user handle, e.g. "ivan". Lowercase letters/digits/underscore,
 * must start with a letter, 3–20 chars.
 */
export const handleSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{2,19}$/,
    'handle must be 3–20 chars: lowercase letters, digits, underscore',
  );

export const displayNameSchema = z.string().trim().min(1).max(50);

/** At least 8 chars; bcrypt caps input at 72 bytes. */
export const passwordSchema = z.string().min(8).max(72);

export const emailSchema = z.string().email().max(254);

/** Best-of frames: odd integer in 1..35 (1, 3, 5, …, 35). */
export const bestOfSchema = z
  .number()
  .int()
  .min(1)
  .max(35)
  .refine((n) => n % 2 === 1, { message: 'bestOf must be odd' });
