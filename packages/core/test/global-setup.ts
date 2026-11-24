import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/rr_test';

export default function setup(): void {
  process.env.DATABASE_URL = TEST_URL;
  process.env.LOG_LEVEL ??= 'silent';
  const root = path.resolve(__dirname, '../../..');
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'packages/core/prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'pipe',
  });
}
