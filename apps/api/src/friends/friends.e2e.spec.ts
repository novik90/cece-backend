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

const sendRequest = (from: { token: string }, toId: string) =>
  http().post('/v1/friends/requests').set(auth(from.token)).send({ userId: toId });

describe('Friends — send request (F1)', () => {
  it('creates an outgoing request (201)', async () => {
    const me = await makeUser('ivan');
    const masha = await makeUser('masha');

    const res = await sendRequest(me, masha.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ direction: 'outgoing', user: { id: masha.id, handle: 'masha' } });
    expect(res.body.id).toBeTruthy();
  });

  it('auto-befriends when a counter-request already exists (200)', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    await sendRequest(a, b.id).expect(201);

    const res = await sendRequest(b, a.id); // counter
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ befriended: true, friend: { id: a.id, handle: 'alice', displayName: 'alice' } });

    // both now see each other as friends
    const aFriends = await http().get('/v1/friends').set(auth(a.token));
    const bFriends = await http().get('/v1/friends').set(auth(b.token));
    expect(aFriends.body.friends.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect(bFriends.body.friends.map((f: { id: string }) => f.id)).toEqual([a.id]);
  });

  it('409 already_friends and friend_request_exists', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    await sendRequest(a, b.id).expect(201);

    const dup = await sendRequest(a, b.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('friend_request_exists');

    await sendRequest(b, a.id).expect(200); // befriend
    const again = await sendRequest(a, b.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_friends');
  });

  it('422 when inviting yourself, 404 for an unknown user', async () => {
    const me = await makeUser('ivan');
    const self = await sendRequest(me, me.id);
    expect(self.status).toBe(422);

    const ghost = await sendRequest(me, 'no-such-user');
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('user_not_found');
  });

  it('401 without a token', async () => {
    const res = await http().post('/v1/friends/requests').send({ userId: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('Friends — list requests (F2)', () => {
  it('separates incoming and outgoing', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    await sendRequest(a, b.id).expect(201);

    const aOut = await http().get('/v1/friends/requests?direction=outgoing').set(auth(a.token));
    expect(aOut.body.requests).toHaveLength(1);
    expect(aOut.body.requests[0]).toMatchObject({ direction: 'outgoing', user: { id: b.id } });

    const bIn = await http().get('/v1/friends/requests').set(auth(b.token)); // default incoming
    expect(bIn.body.requests).toHaveLength(1);
    expect(bIn.body.requests[0]).toMatchObject({ direction: 'incoming', user: { id: a.id } });

    // crossed views are empty
    const aIn = await http().get('/v1/friends/requests?direction=incoming').set(auth(a.token));
    expect(aIn.body.requests).toHaveLength(0);
  });
});

describe('Friends — accept / decline (F3, F4)', () => {
  it('accept makes them friends and clears the pending request', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const req = await sendRequest(a, b.id).expect(201);

    const acc = await http().post(`/v1/friends/requests/${req.body.id}/accept`).set(auth(b.token));
    expect(acc.status).toBe(200);
    expect(acc.body.friend).toMatchObject({ id: a.id });

    const bIn = await http().get('/v1/friends/requests').set(auth(b.token));
    expect(bIn.body.requests).toHaveLength(0);
    const bFriends = await http().get('/v1/friends').set(auth(b.token));
    expect(bFriends.body.friends.map((f: { id: string }) => f.id)).toEqual([a.id]);
  });

  it('403 when a non-addressee accepts', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const c = await makeUser('carol');
    const req = await sendRequest(a, b.id).expect(201);

    const res = await http().post(`/v1/friends/requests/${req.body.id}/accept`).set(auth(c.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('404 for an unknown request, 409 when it is no longer pending', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const req = await sendRequest(a, b.id).expect(201);

    const missing = await http().post('/v1/friends/requests/nope/accept').set(auth(b.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('friend_request_not_found');

    await http().post(`/v1/friends/requests/${req.body.id}/accept`).set(auth(b.token)).expect(200);
    const again = await http().post(`/v1/friends/requests/${req.body.id}/accept`).set(auth(b.token));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('request_not_pending');
  });

  it('decline removes the request and does not create a friendship', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const req = await sendRequest(a, b.id).expect(201);

    const dec = await http().post(`/v1/friends/requests/${req.body.id}/decline`).set(auth(b.token));
    expect(dec.status).toBe(200);
    expect(dec.body).toEqual({ ok: true });

    const bFriends = await http().get('/v1/friends').set(auth(b.token));
    expect(bFriends.body.friends).toHaveLength(0);
    const bIn = await http().get('/v1/friends/requests').set(auth(b.token));
    expect(bIn.body.requests).toHaveLength(0);
  });
});

describe('Friends — remove (F6)', () => {
  it('removes a friend (204) then 404 not_friends on a second try', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const req = await sendRequest(a, b.id).expect(201);
    await http().post(`/v1/friends/requests/${req.body.id}/accept`).set(auth(b.token)).expect(200);

    await http().delete(`/v1/friends/${b.id}`).set(auth(a.token)).expect(204);

    const aFriends = await http().get('/v1/friends').set(auth(a.token));
    expect(aFriends.body.friends).toHaveLength(0);

    const again = await http().delete(`/v1/friends/${b.id}`).set(auth(a.token));
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('not_friends');
  });
});
