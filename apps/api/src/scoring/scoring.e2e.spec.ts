import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type { MatchLiveState } from '@cece/contract';
import { createE2eApp } from '../test-support/e2e-app';
import type { FakePrisma } from '../test-support/prisma-fake';

type Ack = { ok?: true; version?: number; error?: { code: string; message: string } };

let app: INestApplication;
let prisma: FakePrisma;
let baseUrl: string;
const sockets: Socket[] = [];

beforeEach(async () => {
  ({ app, prisma } = await createE2eApp());
  await app.listen(0);
  const addr = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://localhost:${addr.port}`;
});

afterEach(async () => {
  for (const s of sockets) s.close();
  sockets.length = 0;
  await app.close();
});

// ── helpers ──────────────────────────────────────────────────────────────────
const http = () => request(app.getHttpServer());

async function makeUser(handle: string): Promise<{ id: string; token: string }> {
  const r = await http()
    .post('/v1/auth/register')
    .send({ email: `${handle}@mail.com`, password: 's3cret!!', displayName: handle, handle })
    .expect(201);
  return { id: r.body.user.id, token: r.body.token };
}

async function makeMatch(token: string, opponent: object): Promise<string> {
  const r = await http()
    .post('/v1/matches')
    .set('authorization', `Bearer ${token}`)
    .send({ opponent, bestOf: 3 })
    .expect(201);
  return r.body.id;
}

/** A direct user-vs-user match requires friendship; make the two friends. */
async function befriend(a: { token: string }, b: { id: string; token: string }): Promise<void> {
  const req = await http()
    .post('/v1/friends/requests')
    .set('authorization', `Bearer ${a.token}`)
    .send({ userId: b.id })
    .expect(201);
  await http()
    .post(`/v1/friends/requests/${req.body.id}/accept`)
    .set('authorization', `Bearer ${b.token}`)
    .expect(200);
}

function connect(token: string): Socket {
  const s = io(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return s;
}

const connected = (s: Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });

const emit = (s: Socket, event: string, payload: object = {}): Promise<Ack> =>
  new Promise((resolve) => s.emit(event, payload, resolve));

const nextState = (s: Socket): Promise<MatchLiveState> =>
  new Promise((resolve) => s.once('match:state', resolve));

/** Connect, wait for the handshake, join the match (consuming the snapshot). */
async function join(token: string, matchId: string): Promise<Socket> {
  const s = connect(token);
  await connected(s);
  const snapshot = nextState(s);
  const ack = await emit(s, 'match:join', { matchId });
  expect(ack).toEqual({ ok: true, version: expect.any(Number) });
  await snapshot;
  return s;
}

// ── connection & authz ───────────────────────────────────────────────────────
describe('connection', () => {
  it('rejects a bad token at the handshake', async () => {
    const s = connect('garbage.jwt');
    const err = await new Promise<Error>((resolve) => s.once('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
  });

  it('a participant joins and gets a snapshot', async () => {
    const me = await makeUser('ivan');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s = connect(me.token);
    await connected(s);
    const state = nextState(s);
    const ack = await emit(s, 'match:join', { matchId });
    expect(ack).toEqual({ ok: true, version: 0 });
    const snap = await state;
    expect(snap).toMatchObject({ matchId, status: 'scheduled', framesWon: [0, 0] });
  });

  it('a non-participant is refused with not_participant', async () => {
    const me = await makeUser('ivan');
    const stranger = await makeUser('oleg');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s = connect(stranger.token);
    await connected(s);
    const ack = await emit(s, 'match:join', { matchId });
    expect(ack).toEqual({ error: { code: 'not_participant', message: expect.any(String) } });
  });

  it('refuses actions before joining a match', async () => {
    const me = await makeUser('ivan');
    const s = connect(me.token);
    await connected(s);
    const ack = await emit(s, 'score:pot', { ball: 'red' });
    expect(ack).toEqual({ error: { code: 'validation_error', message: 'Join a match first' } });
  });
});

// ── scoring & broadcast ──────────────────────────────────────────────────────
describe('scoring', () => {
  it('broadcasts state to both participants on a pot', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    await befriend(a, b);
    const matchId = await makeMatch(a.token, { userId: b.id });
    const sa = await join(a.token, matchId);
    const sb = await join(b.token, matchId);

    const bSees = nextState(sb);
    const ack = await emit(sa, 'score:pot', { ball: 'red' });
    expect(ack).toEqual({ ok: true, version: 1 });

    const seen = await bSees;
    expect(seen.status).toBe('live');
    expect(seen.frame!.scores).toEqual([1, 0]);
    expect(seen.frame!.redsRemaining).toBe(14);
  });

  it('plays pot/foul/endVisit/undo with correct state', async () => {
    const me = await makeUser('ivan');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s = await join(me.token, matchId);

    expect((await emit(s, 'score:pot', { ball: 'red' })).version).toBe(1);
    expect((await emit(s, 'score:pot', { ball: 'black' })).version).toBe(2);
    let st = nextState(s);
    await emit(s, 'score:endVisit', {});
    expect((await st).frame!.striker).toBe(1);

    st = nextState(s);
    await emit(s, 'score:undo', {}); // undo the endVisit → striker back to 0
    const afterUndo = await st;
    expect(afterUndo.frame!.striker).toBe(0);
    expect(afterUndo.frame!.scores).toEqual([8, 0]);
    expect(afterUndo.version).toBe(4); // pot, pot, endVisit, undo
  });

  it('offers a free ball after a foul and applies score:freeBall', async () => {
    const me = await makeUser('ivan');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s = await join(me.token, matchId);

    // free ball not available yet
    expect(await emit(s, 'score:freeBall', {})).toEqual({
      error: { code: 'free_ball_not_available', message: expect.any(String) },
    });

    let st = nextState(s);
    await emit(s, 'score:foul', { points: 4 }); // turn → slot 1, free ball offered
    expect((await st).frame!.freeBallAvailable).toBe(true);

    st = nextState(s);
    const ack = await emit(s, 'score:freeBall', {});
    expect(ack).toEqual({ ok: true, version: 2 });
    const seen = await st;
    expect(seen.frame!.scores).toEqual([0, 5]); // foul 4 + free ball 1, to slot 1
    expect(seen.frame!.redsRemaining).toBe(15); // no red removed
    expect(seen.frame!.freeBallAvailable).toBe(false);
  });

  it('enters respotted-black sudden death on a tie and settles it on the next black', async () => {
    const me = await makeUser('ivan');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s = await join(me.token, matchId);
    const pot = (ball: string): Promise<Ack> => emit(s, 'score:pot', { ball });

    // slot 0 builds 22, hands over; slot 1 makes 15 then ties on the black.
    for (let i = 0; i < 15; i++) await pot('red');
    await pot('yellow'); // free colour → colors phase, colorOn yellow
    await pot('yellow');
    await pot('green'); // slot 0 = 22, colorOn brown
    await emit(s, 'score:endVisit', {}); // → striker 1
    await pot('brown');
    await pot('blue');
    await pot('pink'); // slot 1 = 15, only the black left

    const tie = nextState(s);
    await pot('black'); // slot 1 +7 = 22 → tie → respotted black
    const rb = await tie;
    expect(rb.frame!.respottedBlack).toBe(true);
    expect(rb.frame!.scores).toEqual([22, 22]);
    expect(rb.frame!.colorOn).toBe('black');

    // only the black is on in sudden death
    expect(await pot('pink')).toEqual({
      error: { code: 'invalid_action', message: expect.any(String) },
    });

    // potting the black decides the frame for the lot-chosen striker
    const decided = nextState(s);
    expect(await pot('black')).toHaveProperty('ok', true);
    const settled = await decided;
    expect(settled.framesWon[0] + settled.framesWon[1]).toBe(1);
  });

  it('forbids self-scoring when the option is on; the opponent may score', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    await befriend(a, b);
    const matchId = await makeMatch(a.token, { userId: b.id });
    await prisma.match.update({ where: { id: matchId }, data: { selfScoringDisabled: true } });

    const sa = await join(a.token, matchId);
    const sb = await join(b.token, matchId);

    // alice is the striker (slot 0) — cannot pot for herself
    expect(await emit(sa, 'score:pot', { ball: 'red' })).toEqual({
      error: { code: 'self_scoring_forbidden', message: expect.any(String) },
    });
    // bob (slot 1) scores for the striker
    expect((await emit(sb, 'score:pot', { ball: 'red' })).version).toBe(1);
  });

  it('handles frame and match concede', async () => {
    const me = await makeUser('ivan');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s = await join(me.token, matchId);

    let st = nextState(s);
    await emit(s, 'frame:concede', {}); // slot 0 concedes → guest wins the frame
    expect((await st).framesWon).toEqual([0, 1]);

    st = nextState(s);
    await emit(s, 'match:concede', {}); // slot 0 concedes the match
    const done = await st;
    expect(done.status).toBe('completed');
    expect(done.frame).toBeUndefined();
  });
});

// ── reconnect ────────────────────────────────────────────────────────────────
describe('reconnect', () => {
  it('restores state from a fresh snapshot', async () => {
    const me = await makeUser('ivan');
    const matchId = await makeMatch(me.token, { guestName: 'Гость' });
    const s1 = await join(me.token, matchId);
    await emit(s1, 'score:pot', { ball: 'red' }); // version 1
    s1.close();

    const s2 = connect(me.token);
    await connected(s2);
    const state = nextState(s2);
    const ack = await emit(s2, 'match:join', { matchId });
    expect(ack).toEqual({ ok: true, version: 1 });
    const snap = await state;
    expect(snap.frame!.scores).toEqual([1, 0]);
    expect(snap.status).toBe('live');
  });
});
