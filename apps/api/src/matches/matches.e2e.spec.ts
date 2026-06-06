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

function http() {
  return request(app.getHttpServer());
}

/** Register a user and return `{ id, token }`. */
async function makeUser(handle: string): Promise<{ id: string; token: string }> {
  const res = await http()
    .post('/v1/auth/register')
    .send({ email: `${handle}@mail.com`, password: 's3cret!!', displayName: handle, handle })
    .expect(201);
  return { id: res.body.user.id, token: res.body.token };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Matches — create (C5)', () => {
  it('creates a match against a guest; creator is participants[0]', async () => {
    const me = await makeUser('ivan');

    const res = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { guestName: 'Гость' }, bestOf: 5 });

    expect(res.status).toBe(201);
    expect(res.body.ownerId).toBe(me.id);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.framesWon).toEqual([0, 0]);
    expect(res.body.participants[0]).toMatchObject({ kind: 'user', userId: me.id });
    expect(res.body.participants[1]).toEqual({ kind: 'guest', name: 'Гость' });
  });

  it('creates a match against a registered opponent', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');

    const res = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { userId: opp.id }, bestOf: 3 });

    expect(res.status).toBe(201);
    expect(res.body.participants[1]).toMatchObject({ kind: 'user', userId: opp.id });
  });

  it('returns 404 user_not_found for a missing opponent', async () => {
    const me = await makeUser('ivan');
    const res = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { userId: 'no-such-user' }, bestOf: 5 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('user_not_found');
  });

  it('returns 422 when the opponent is yourself', async () => {
    const me = await makeUser('ivan');
    const res = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { userId: me.id }, bestOf: 5 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 422 for an even bestOf', async () => {
    const me = await makeUser('ivan');
    const res = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { guestName: 'Гость' }, bestOf: 4 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 401 without a token', async () => {
    const res = await http()
      .post('/v1/matches')
      .send({ opponent: { guestName: 'Гость' }, bestOf: 5 });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});

describe('Matches — list, only mine (C6)', () => {
  it('lists matches where I am a participant (owner or opponent), not others', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const c = await makeUser('carol');

    // alice creates a match against bob → both are participants.
    await http()
      .post('/v1/matches')
      .set(auth(a.token))
      .send({ opponent: { userId: b.id }, bestOf: 5 })
      .expect(201);

    const aList = await http().get('/v1/matches').set(auth(a.token));
    const bList = await http().get('/v1/matches').set(auth(b.token));
    const cList = await http().get('/v1/matches').set(auth(c.token));

    expect(aList.body.matches).toHaveLength(1);
    expect(bList.body.matches).toHaveLength(1); // opponent sees it too
    expect(cList.body.matches).toHaveLength(0); // stranger sees nothing
  });

  it('filters by status and returns newest first', async () => {
    const me = await makeUser('ivan');
    await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { guestName: 'G1' }, bestOf: 5 })
      .expect(201);
    await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { guestName: 'G2' }, bestOf: 5 })
      .expect(201);

    const all = await http().get('/v1/matches?status=all').set(auth(me.token));
    expect(all.body.matches).toHaveLength(2);
    // newest first: the second guest (G2) comes first
    expect(all.body.matches[0].participants[1]).toEqual({ kind: 'guest', name: 'G2' });

    const completed = await http().get('/v1/matches?status=completed').set(auth(me.token));
    expect(completed.body.matches).toHaveLength(0); // all are scheduled
  });

  it('returns 401 without a token', async () => {
    const res = await http().get('/v1/matches');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});

describe('Matches — get one, participant only (C7)', () => {
  it('returns the match for a participant', async () => {
    const me = await makeUser('ivan');
    const created = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { guestName: 'Гость' }, bestOf: 5 })
      .expect(201);

    const res = await http().get(`/v1/matches/${created.body.id}`).set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('returns 403 not_participant for a stranger', async () => {
    const me = await makeUser('ivan');
    const stranger = await makeUser('oleg');
    const created = await http()
      .post('/v1/matches')
      .set(auth(me.token))
      .send({ opponent: { guestName: 'Гость' }, bestOf: 5 })
      .expect(201);

    const res = await http().get(`/v1/matches/${created.body.id}`).set(auth(stranger.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_participant');
  });

  it('returns 404 match_not_found for an unknown id', async () => {
    const me = await makeUser('ivan');
    const res = await http().get('/v1/matches/no-such-match').set(auth(me.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('match_not_found');
  });

  it('returns 401 without a token', async () => {
    const res = await http().get('/v1/matches/whatever');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});
