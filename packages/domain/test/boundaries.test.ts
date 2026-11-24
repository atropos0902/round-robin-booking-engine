import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../src');
const importsOf = (file: string) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
const files = (dir: string) => fs.readdirSync(path.join(root, dir)).map((f) => path.join(root, dir, f));

describe('context boundaries', () => {
  it('the domain imports nothing but itself and Temporal', () => {
    for (const dir of ['availability', 'assignment', 'booking']) {
      for (const file of files(dir)) {
        for (const name of importsOf(file)) expect(name.startsWith('.') || name === '@js-temporal/polyfill').toBe(true);
      }
    }
  });

  it('availability knows nothing about assignment or booking', () => {
    for (const file of files('availability')) {
      for (const name of importsOf(file)) expect(name).not.toMatch(/assignment|booking/);
    }
  });

  it('assignment uses availability for its types only', () => {
    for (const file of files('assignment')) {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n').filter((l) => l.includes("from '../"))) expect(line).toMatch(/^import type/);
    }
  });
});
