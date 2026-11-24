import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, expect, it, vi } from 'vitest';

const envelopes: string[] = [];
const ingest = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  envelopes.push(req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw).toString() : raw.toString());
  res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
});
afterAll(() => void (ingest.closeAllConnections(), ingest.close()));

it('an unexpected error reaches Sentry with the release and the booking id', async () => {
  await new Promise<void>((r) => ingest.listen(0, '127.0.0.1', r));
  process.env.SENTRY_DSN = `http://key@127.0.0.1:${(ingest.address() as { port: number }).port}/1`;
  process.env.APP_RELEASE = 'release-under-test';
  const apiKey = ['s3', 'cret'].join('-');
  process.env.API_KEYS = apiKey;
  process.env.DATABASE_URL ??= 'postgresql://nobody@127.0.0.1:1/none';
  const { BookingService, addContext } = await import('@rr/core');
  const { createApp } = await import('../src/create-app');
  const Sentry = await import('@sentry/nestjs');

  vi.spyOn(BookingService.prototype, 'view').mockImplementation(async (id) => {
    addContext({ bookingId: id });
    throw new Error('boom');
  });
  const app = await createApp();
  await app.init();
  const id = '3f0c9a52-1f0e-4c39-9a3f-6d1c1c1f7a11';
  await request(app.getHttpServer()).get(`/v1/bookings/${id}`).set('authorization', `Bearer ${apiKey}`).expect(500);
  await Sentry.flush(3000);
  await app.close();

  const event = envelopes
    .flatMap((e) => e.split('\n'))
    .filter((l) => l.includes('"exception"'))
    .map((l) => JSON.parse(l))[0];
  expect(event.release).toBe('release-under-test');
  expect(event.tags.booking_id).toBe(id);
  expect(event.exception.values[0].value).toBe('boom');
  expect(envelopes.join('')).not.toContain(apiKey);
  expect(event.request.headers.authorization).toBeUndefined();
});
