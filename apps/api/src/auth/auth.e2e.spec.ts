import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from '../test-support/e2e-app';

const VALID = {
  email: 'ivan@mail.com',
  password: 's3cret!!',
  displayName: 'Иван',
  handle: 'ivan',
};

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

describe('Auth — register (C1)', () => {
  it('creates a user and returns a token + user without the password hash', async () => {
    const res = await http().post('/v1/auth/register').send(VALID);

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({
      handle: 'ivan',
      displayName: 'Иван',
      email: 'ivan@mail.com',
    });
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('rejects a duplicate email with 409 email_taken', async () => {
    await http().post('/v1/auth/register').send(VALID).expect(201);
    const res = await http()
      .post('/v1/auth/register')
      .send({ ...VALID, handle: 'ivan2' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('rejects a duplicate handle with 409 handle_taken', async () => {
    await http().post('/v1/auth/register').send(VALID).expect(201);
    const res = await http()
      .post('/v1/auth/register')
      .send({ ...VALID, email: 'other@mail.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('handle_taken');
  });

  it('rejects a weak password with 422 validation_error', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send({ ...VALID, password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects an invalid handle with 422 validation_error', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send({ ...VALID, handle: 'Bad Handle!' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('Auth — login (C2)', () => {
  beforeEach(async () => {
    await http().post('/v1/auth/register').send(VALID).expect(201);
  });

  it('returns a token for valid credentials', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: VALID.email, password: VALID.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe(VALID.email);
  });

  it('rejects a wrong password with 401 invalid_credentials', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: VALID.email, password: 'wrong-pass' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('rejects an unknown email with 401 invalid_credentials', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: 'nobody@mail.com', password: VALID.password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });
});

describe('Auth — JWT guard on /me (C3)', () => {
  it('returns the current user for a valid token', async () => {
    const reg = await http().post('/v1/auth/register').send(VALID).expect(201);
    const res = await http().get('/v1/me').set('Authorization', `Bearer ${reg.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ handle: 'ivan', email: 'ivan@mail.com' });
  });

  it('rejects a missing token with 401 unauthorized', async () => {
    const res = await http().get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a malformed token with 401 unauthorized', async () => {
    const res = await http().get('/v1/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});
