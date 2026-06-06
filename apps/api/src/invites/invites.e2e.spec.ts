import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from '../test-support/e2e-app';
import type { FakePrisma } from '../test-support/prisma-fake';

let app: INestApplication;
let prisma: FakePrisma;

beforeEach(async () => {
  ({ app, prisma } = await createE2eApp());
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

const createInvite = (from: { token: string }, toId: string, body: object = {}) =>
  http()
    .post('/v1/invites')
    .set(auth(from.token))
    .send({ userId: toId, bestOf: 5, ...body });

describe('Invites — create (I1)', () => {
  it('creates a pending invite with from/to and an expiry', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');

    const res = await createInvite(me, opp.id, { selfScoringDisabled: true, firstBreaker: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'pending',
      from: { id: me.id },
      to: { id: opp.id },
      bestOf: 5,
      selfScoringDisabled: true,
      firstBreaker: 1,
    });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('422 inviting yourself, 404 unknown target, 401 without token', async () => {
    const me = await makeUser('ivan');
    expect((await createInvite(me, me.id)).status).toBe(422);

    const ghost = await createInvite(me, 'no-such-user');
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('user_not_found');

    const noAuth = await http().post('/v1/invites').send({ userId: 'x', bestOf: 5 });
    expect(noAuth.status).toBe(401);
  });
});

describe('Invites — list (I2)', () => {
  it('separates incoming and outgoing, newest first', async () => {
    const me = await makeUser('ivan');
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    await createInvite(me, a.id).expect(201);
    await createInvite(me, b.id).expect(201);

    const out = await http().get('/v1/invites?direction=outgoing').set(auth(me.token));
    expect(out.body.invites).toHaveLength(2);
    expect(out.body.invites[0].to.id).toBe(b.id); // newest first

    const aIn = await http().get('/v1/invites').set(auth(a.token)); // default incoming
    expect(aIn.body.invites).toHaveLength(1);
    expect(aIn.body.invites[0]).toMatchObject({ from: { id: me.id }, status: 'pending' });
  });
});

describe('Invites — accept (I3)', () => {
  it('creates the match (sender = slot 0) and links it; visible to both', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');
    const inv = await createInvite(me, opp.id, { bestOf: 3 }).expect(201);

    const acc = await http().post(`/v1/invites/${inv.body.id}/accept`).set(auth(opp.token));
    expect(acc.status).toBe(201);
    expect(acc.body.ownerId).toBe(me.id);
    expect(acc.body.bestOf).toBe(3);
    expect(acc.body.participants[0]).toMatchObject({ kind: 'user', userId: me.id });
    expect(acc.body.participants[1]).toMatchObject({ kind: 'user', userId: opp.id });

    // the match is now listed for both participants
    const mineList = await http().get('/v1/matches').set(auth(me.token));
    expect(mineList.body.matches.map((m: { id: string }) => m.id)).toContain(acc.body.id);
    const oppList = await http().get('/v1/matches').set(auth(opp.token));
    expect(oppList.body.matches.map((m: { id: string }) => m.id)).toContain(acc.body.id);

    // the invite is now accepted and carries matchId
    const oppIn = await http().get('/v1/invites?status=accepted').set(auth(opp.token));
    expect(oppIn.body.invites[0]).toMatchObject({ status: 'accepted', matchId: acc.body.id });
  });

  it('403 when a non-invitee accepts; 409 when accepted twice', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');
    const stranger = await makeUser('sam');
    const inv = await createInvite(me, opp.id).expect(201);

    const forbidden = await http().post(`/v1/invites/${inv.body.id}/accept`).set(auth(stranger.token));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('forbidden');

    await http().post(`/v1/invites/${inv.body.id}/accept`).set(auth(opp.token)).expect(201);
    const again = await http().post(`/v1/invites/${inv.body.id}/accept`).set(auth(opp.token));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invite_not_pending');
  });

  it('409 invite_expired once past expiry', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');
    const inv = await createInvite(me, opp.id).expect(201);
    // force expiry in the store
    await prisma.matchInvite.update({
      where: { id: inv.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await http().post(`/v1/invites/${inv.body.id}/accept`).set(auth(opp.token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invite_expired');

    // and it surfaces as expired in listings
    const oppIn = await http().get('/v1/invites').set(auth(opp.token));
    expect(oppIn.body.invites[0].status).toBe('expired');
  });

  it('404 for an unknown invite', async () => {
    const me = await makeUser('ivan');
    const res = await http().post('/v1/invites/nope/accept').set(auth(me.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('invite_not_found');
  });
});

describe('Invites — decline / cancel (I4, I5)', () => {
  it('invitee declines; status becomes declined', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');
    const inv = await createInvite(me, opp.id).expect(201);

    const dec = await http().post(`/v1/invites/${inv.body.id}/decline`).set(auth(opp.token));
    expect(dec.status).toBe(200);
    expect(dec.body).toEqual({ ok: true });

    const oppIn = await http().get('/v1/invites').set(auth(opp.token));
    expect(oppIn.body.invites[0].status).toBe('declined');
  });

  it('sender cancels; a non-sender gets 403', async () => {
    const me = await makeUser('ivan');
    const opp = await makeUser('oleg');
    const inv = await createInvite(me, opp.id).expect(201);

    const byInvitee = await http().post(`/v1/invites/${inv.body.id}/cancel`).set(auth(opp.token));
    expect(byInvitee.status).toBe(403);

    const cancelled = await http().post(`/v1/invites/${inv.body.id}/cancel`).set(auth(me.token));
    expect(cancelled.status).toBe(200);

    const mineOut = await http().get('/v1/invites?direction=outgoing').set(auth(me.token));
    expect(mineOut.body.invites[0].status).toBe('cancelled');
  });
});
