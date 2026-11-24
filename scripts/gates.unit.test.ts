import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { problems } from './check-migrations.mjs';
import { review, risk, rollbackNote } from './pr-risk.mjs';

describe('pull request risk', () => {
  it('flags the paths that can double-book people or break queued messages', () => {
    expect(risk(['packages/domain/src/assignment/assign.ts'])).toEqual(['assignment']);
    expect(risk(['packages/core/prisma/migrations/0002_x/migration.sql', 'packages/core/src/contracts.ts'])).toEqual(['event shapes', 'migrations']);
    expect(risk(['README.md', 'apps/web/src/pages/index.tsx', 'packages/domain/test/slots.test.ts'])).toEqual([]);
  });

  it('wants a rollback note, and the template text does not count as one', () => {
    const files = ['packages/core/src/booking/booking-service.ts'];
    const template = '## What changes\nx\n## Rollback\n<!-- How is this taken back once it is live? -->\n## Checks\ny';
    expect(rollbackNote(template)).toBe('');
    expect(review(files, template).ok).toBe(false);
    expect(review(files, template.replace('## Checks', 'Revert the commit, balances stay valid.\n## Checks')).ok).toBe(true);
    expect(review(['README.md'], '').ok).toBe(true);
  });
});

describe('migrations', () => {
  const m = (name: string, sql: string) => ({ name, sql });
  it('let additive changes through', () => {
    expect(problems([m('1', 'ALTER TABLE "host" ADD COLUMN "nickname" TEXT;'), m('2', 'ALTER TABLE a ADD COLUMN b INT NOT NULL DEFAULT 0;')])).toEqual([]);
    expect(problems([m('1', '-- DROP TABLE is only mentioned here\nCREATE TABLE a ();')])).toEqual([]);
  });

  it.each([
    'DROP TABLE a;',
    'ALTER TABLE a DROP COLUMN b;',
    'ALTER TABLE a RENAME COLUMN b TO c;',
    'ALTER TABLE a RENAME TO c;',
    'ALTER TABLE a ALTER COLUMN "b" SET DATA TYPE TEXT;',
    'ALTER TABLE a ALTER COLUMN b SET NOT NULL;',
    'ALTER TABLE a ADD COLUMN b INT NOT NULL;',
    'ALTER TABLE booking DROP CONSTRAINT booking_no_overlap;',
  ])('stop %s unless it names the step before it', (sql) => {
    expect(problems([m('1', 'SELECT 1'), m('2', sql)])).toHaveLength(1);
    expect(problems([m('1', 'SELECT 1'), m('2', `-- contract: 1\n${sql}`)])).toEqual([]);
    expect(problems([m('1', 'SELECT 1'), m('2', `-- contract: 3\n${sql}`)])).toHaveLength(1);
  });
});

describe('incident alert', () => {
  it('sends the release to incident.io', async () => {
    const seen: { url?: string; auth?: string; body?: Record<string, unknown> } = {};
    const server = http.createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      Object.assign(seen, { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(202).end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const env = {
      ...process.env,
      INCIDENT_API: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      INCIDENT_ALERT_SOURCE_ID: 'src',
      INCIDENT_ALERT_TOKEN: 'tok',
      RELEASE: 'abc',
    };
    const out = await new Promise<string>((resolve, reject) =>
      execFile('node', [path.join(__dirname, 'open-incident.mjs')], { env }, (e, stdout) => (e ? reject(e) : resolve(stdout))),
    );
    server.closeAllConnections();
    server.close();
    expect(out).toContain('Alert raised');
    expect(seen).toMatchObject({ url: '/v2/alert_events/http/src', auth: 'Bearer tok', body: { status: 'firing', deduplication_key: 'release-abc' } });
  });
});
