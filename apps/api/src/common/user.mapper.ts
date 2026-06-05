import type { User as PrismaUser } from '@prisma/client';
import type { PublicUser, User } from '@cece/contract';

/** Map a DB user to the full contract `User` (used by auth and `/me`). */
export function toUser(u: PrismaUser): User {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Public projection (no email) — search results and participants. */
export function toPublicUser(u: PrismaUser): PublicUser {
  return { id: u.id, handle: u.handle, displayName: u.displayName };
}
