import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './primitives';
import { publicUserSchema } from './user';

/** Whether a pending friend request was sent to me (incoming) or by me (outgoing). */
export const friendRequestDirectionSchema = z.enum(['incoming', 'outgoing']);
export type FriendRequestDirection = z.infer<typeof friendRequestDirectionSchema>;

/** A pending friend request, from the current user's point of view. */
export const friendRequestSchema = z.object({
  id: idSchema,
  /** The other party (sender if incoming, addressee if outgoing). */
  user: publicUserSchema,
  direction: friendRequestDirectionSchema,
  createdAt: isoDateTimeSchema,
});
export type FriendRequest = z.infer<typeof friendRequestSchema>;

/** F1 — POST /v1/friends/requests. */
export const createFriendRequestSchema = z.object({ userId: idSchema }).strict();
export type CreateFriendRequest = z.infer<typeof createFriendRequestSchema>;

/**
 * F1 response. Normally the freshly created outgoing request (201). If a
 * counter-request already existed, the two become friends immediately (200).
 */
export const createFriendRequestResponseSchema = z.union([
  friendRequestSchema,
  z.object({ befriended: z.literal(true), friend: publicUserSchema }),
]);
export type CreateFriendRequestResponse = z.infer<typeof createFriendRequestResponseSchema>;

/** F2 — GET /v1/friends/requests?direction=incoming|outgoing (default incoming). */
export const friendRequestListQuerySchema = z.object({
  direction: friendRequestDirectionSchema.default('incoming'),
});
export type FriendRequestListQuery = z.infer<typeof friendRequestListQuerySchema>;

export const friendRequestListResponseSchema = z.object({
  requests: z.array(friendRequestSchema),
});
export type FriendRequestListResponse = z.infer<typeof friendRequestListResponseSchema>;

/** F3 — POST /v1/friends/requests/:id/accept. */
export const acceptFriendRequestResponseSchema = z.object({ friend: publicUserSchema });
export type AcceptFriendRequestResponse = z.infer<typeof acceptFriendRequestResponseSchema>;

/** F5 — GET /v1/friends. */
export const friendListResponseSchema = z.object({
  friends: z.array(publicUserSchema),
});
export type FriendListResponse = z.infer<typeof friendListResponseSchema>;
