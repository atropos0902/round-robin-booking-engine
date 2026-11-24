// During a deploy old and new code run against the same schema. A migration that breaks the old
// code is only allowed as the second step, and says so with a "-- contract: <migration>" line
// naming the migration that stopped the old code from using it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BREAKING = [
  [/\bDROP\s+TABLE\b/i, 'drops a table'],
  [/\bDROP\s+COLUMN\b/i, 'drops a column'],
  [/\bRENAME\s+(COLUMN\s+)?("?\w+"?\s+)?TO\b/i, 'renames something'],
  [/\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, 'changes a column type'],
  [/\bALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL\b/i, 'makes a column required'],
  [/\bADD\s+COLUMN\s+(?![^,;]*\bDEFAULT\b)[^,;]*\bNOT\s+NULL\b/i, 'adds a required column without a default'],
  [/\bDROP\s+CONSTRAINT\s+"?booking_no_overlap"?/i, 'removes the guard against double-booking'],
];

export function problems(migrations) {
  const names = migrations.map((m) => m.name);
  const out = [];
  for (const [i, { name, sql }] of migrations.entries()) {
    const bare = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const breaking = BREAKING.filter(([pattern]) => pattern.test(bare)).map(([, what]) => what);
    if (breaking.length === 0) continue;
    const expand = /^--\s*contract:\s*(\S+)/m.exec(sql)?.[1];
    if (!expand) out.push(`${name} ${breaking.join(' and ')}. Split it, and name the first step with "-- contract:".`);
    else if (!names.slice(0, i).includes(expand)) out.push(`${name} names ${expand}, which is not an earlier migration.`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = path.resolve(import.meta.dirname, '../packages/core/prisma/migrations');
  const migrations = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, sql: fs.readFileSync(path.join(dir, d.name, 'migration.sql'), 'utf8') }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const found = problems(migrations);
  found.forEach((p) => console.error(p));
  process.exit(found.length ? 1 : 0);
}
