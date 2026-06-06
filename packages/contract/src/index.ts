/**
 * @cece/contract — single source of truth for the v1 API.
 *
 * Zod schemas are authoritative; TypeScript types are derived via `z.infer`.
 * The API validates I/O against these schemas and clients follow them.
 */
export const CONTRACT_VERSION = 'v1' as const;

export * from './error';
export * from './primitives';
export * from './user';
export * from './match';
export * from './auth';
export * from './users';
export * from './matches';
export * from './scoring';
export * from './friends';
export * from './invites';
