import http from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingService, db } from '@rr/core';
import { NOON, at, host, invitee, reset, rotation } from '../../../packages/core/test/fixtures';
import handler from '../src/vercel';

// Through the function handler, because that is what runs in production.
const server = http.createServer((req, res) => void handler(req, res));
const auth = { authorization: 'Bearer key-two' };

beforeAll(() => {
  process.env.API_KEYS = 'key-one, key-two';
});
afterAll(() => void server.close());
beforeEach(() => reset());

const book = (body: object, key: string | null = randomUUID()) => {
  const r = request(server).post('/v1/bookings').set(auth);
  return (key ? r.set('idempotency-key', key) : r).send(body);
};

describe('REST API', () => {
  it('turns away a missing or wrong key', async () => {
    for (const value of ['', 'Bearer ', 'Bearer nope', 'Bearer key-one, key-two']) {
      await request(server).get('/v1/event-types').set('authorization', value).expect(401);
    }
    await request(server).get('/v1/event-types').set(auth).expect(200, []);
  });

  it('lists, books, explains and cancels', async () => {
    await rotation('demo', [await host('Ana'), await host('Ben')]);
    const query = { slug: 'demo', from: new Date(NOON).toISOString(), to: new Date(NOON + 3600_000).toISOString() };
    const open = await request(server).get('/v1/slots').query(query).set(auth).expect(200);
    expect(open.body.slots).toHaveLength(2);

    const created = await book({ slug: 'demo', start: open.body.slots[0], invitee }).expect(201);
    expect(created.headers['x-request-id']).toBeTruthy();
    const why = await request(server).get(`/v1/bookings/${created.body.id}/assignment`).set(auth).expect(200);
    expect(why.body.reasons).toHaveLength(2);

    const seen = await request(server).get(`/v1/bookings/${created.body.id}`).set(auth).expect(200);
    expect(seen.body.manageToken).toBeUndefined();
    const cancelled = await request(server).delete(`/v1/bookings/${created.body.id}`).set(auth).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await request(server).delete(`/v1/bookings/${created.body.id}`).set(auth).expect(409);
  });

  it('answers a retried request with the first booking', async () => {
    await rotation('demo', [await host('Ana'), await host('Ben')]);
    const key = randomUUID();
    const first = await book({ slug: 'demo', start: at(0), invitee }, key).expect(201);
    const second = await book({ slug: 'demo', start: at(0), invitee }, key).expect(201);
    expect(second.body.id).toBe(first.body.id);
    await book({ slug: 'demo', start: at(30), invitee }, key).expect(422);
    await book({ slug: 'demo', start: at(30), invitee }, null).expect(400);
  });

  it('maps every expected problem to a status, with a code', async () => {
    await rotation('demo', [await host('Ana')]);
    await book({ slug: 'nope', start: at(0), invitee }).expect(404);
    await book({ slug: 'demo', start: at(1), invitee }).expect(422);
    await book({ slug: 'demo', start: at(0), invitee }).expect(201);
    const taken = await book({ slug: 'demo', start: at(0), invitee }).expect(409);
    expect(taken.body.error).toBe('no_host_available');
    const invalid = await book({ slug: 'demo', start: at(0), invitee: { ...invitee, timeZone: 'Mars/Base' } }).expect(422);
    expect(invalid.body.issues[0].path).toBe('invitee.timeZone');
    await request(server).get('/v1/bookings/not-a-uuid').set(auth).expect(400);
    const long = { slug: 'demo', from: at(0).toISOString(), to: at(40 * 24 * 60).toISOString() };
    await request(server).get('/v1/slots').query(long).set(auth).expect(422);
  });

  it('does not leak what went wrong inside', async () => {
    const spy = vi.spyOn(BookingService.prototype, 'view').mockRejectedValueOnce(new Error('password=hunter2'));
    const r = await request(server).get(`/v1/bookings/${randomUUID()}`).set(auth).expect(500);
    expect(r.text).toBe('{"error":"internal"}');
    spy.mockRestore();
  });

  it('busy times replace the earlier ones from the same calendar and close the slot', async () => {
    const a = await host('Ana');
    await rotation('demo', [a]);
    const body = { source: 'caldav', from: at(-60), to: at(120), blocks: [{ from: at(0), to: at(15) }] };
    const put = (b: object) => request(server).put(`/v1/hosts/${a.id}/busy`).set(auth).send(b);
    await put(body).expect(200);
    await put(body).expect(200);
    expect(await db().busyBlock.count()).toBe(1);
    await book({ slug: 'demo', start: at(0), invitee }).expect(409);
    await put({ ...body, blocks: [] }).expect(200);
    await book({ slug: 'demo', start: at(0), invitee }).expect(201);
  });

  it('reports the release and the outbox', async () => {
    const r = await request(server).get('/healthz').expect(200);
    expect(r.body).toMatchObject({ ok: true, release: 'dev', outbox: { pending: 0 } });
  });
});
