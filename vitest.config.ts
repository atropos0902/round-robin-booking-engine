import path from 'node:path';
import { defineConfig } from 'vitest/config';

const src = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: { '@rr/domain': src('packages/domain/src/index.ts'), '@rr/core': src('packages/core/src/index.ts') },
  },
  test: {
    projects: [
      { extends: true, test: { name: 'domain', include: ['packages/domain/test/**/*.test.ts'], testTimeout: 60_000 } },
      { extends: true, test: { name: 'unit', include: ['{scripts,infra,apps,packages}/**/*.unit.test.ts'], testTimeout: 60_000 } },
      {
        // These share one database, so they run one file at a time.
        extends: true,
        test: {
          name: 'database',
          include: ['{packages/core,apps}/**/*.db.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ['packages/core/test/global-setup.ts'],
        },
      },
    ],
  },
});
