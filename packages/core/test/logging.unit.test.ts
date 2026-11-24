import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addContext, flushLogs, logger, runWithContext } from '../src/observability/logger';

const bodies: string[] = [];
let fail = false;
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  bodies.push(`${req.method} ${req.url}\n${body}`);
  res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json', 'x-elastic-product': 'Elasticsearch' });
  res.end(JSON.stringify({ errors: false, items: [] }));
});

beforeAll(async () => {
  logger.level = 'info';
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});
afterAll(() => {
  delete process.env.ELASTIC_URL;
  server.closeAllConnections();
  server.close();
});

describe('logs', () => {
  it('reach Elastic with the booking id, also when the address is set after import', async () => {
    process.env.ELASTIC_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    runWithContext({ requestId: 'r-1' }, () => {
      addContext({ bookingId: 'b-1' });
      logger.warn({ email: 'someone@example.test', attempt: 2 }, 'hello');
    });
    runWithContext({ requestId: 'r-2' }, () => logger.warn('another request'));
    await flushLogs();

    expect(bodies).toHaveLength(1);
    const lines = bodies[0]!.trim().split('\n');
    expect(lines[0]).toBe('POST /_bulk');
    const [create, first, , second] = lines.slice(1).map((l) => JSON.parse(l));
    expect(create).toEqual({ create: { _index: 'logs-booking-default' } });
    expect(first).toMatchObject({ 'labels.booking_id': 'b-1', 'http.request.id': 'r-1', message: 'hello', attempt: 2 });
    expect(first['@timestamp']).toBeTruthy();
    expect(first.email).toBe('[Redacted]');
    expect(second['labels.booking_id']).toBeUndefined();
  });

  it('an unreachable Elastic does not throw', async () => {
    fail = true;
    logger.warn('lost');
    await expect(flushLogs()).resolves.toBeUndefined();
  });
});
