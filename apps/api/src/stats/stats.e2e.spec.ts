import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from '../test-support/e2e-app';

let app: INestApplication;

beforeEach(async () => {
  ({ app } = await createE2eApp());
});
afterEach(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function makeUser(handle: string): Promise<{ id: string; token: string }> {
  const res = await http()
    .post('/v1/auth/register')
    .send({ email: `${handle}@mail.com`, password: 's3cret!!', displayName: handle, handle })
    .expect(201);
  return { id: res.body.user.id, token: res.body.token };
}

async function befriend(a: { token: string }, b: { id: string; token: string }): Promise<void> {
  const req = await http().post('/v1/friends/requests').set(auth(a.token)).send({ userId: b.id }).expect(201);
  await http().post(`/v1/friends/requests/${req.body.id}/accept`).set(auth(b.token)).expect(200);
}

const ZERO = {
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  framesWon: 0,
  framesLost: 0,
  highestBreak: 0,
  topBreaks: [],
};

describe('Stats — /me/stats', () => {
  it('returns zeroed stats for a fresh user', async () => {
    const me = await makeUser('ivan');
    const res = await http().get('/v1/me/stats').set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: me.id, ...ZERO });
  });

  it('401 without a token', async () => {
    const res = await http().get('/v1/me/stats');
    expect(res.status).toBe(401);
  });
});

describe('Stats — /users/:id/stats', () => {
  it('lets a friend view another user’s stats', async () => {
    const me = await makeUser('ivan');
    const friend = await makeUser('masha');
    await befriend(me, friend);

    const res = await http().get(`/v1/users/${friend.id}/stats`).set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: friend.id, ...ZERO });
  });

  it('403 not_friends for a non-friend', async () => {
    const me = await makeUser('ivan');
    const stranger = await makeUser('oleg');

    const res = await http().get(`/v1/users/${stranger.id}/stats`).set(auth(me.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_friends');
  });

  it('allows viewing your own stats via /users/:id', async () => {
    const me = await makeUser('ivan');
    const res = await http().get(`/v1/users/${me.id}/stats`).set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(me.id);
  });

  it('404 for an unknown user', async () => {
    const me = await makeUser('ivan');
    const res = await http().get('/v1/users/no-such-user/stats').set(auth(me.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('user_not_found');
  });
});
