// Decides whether a pull request is high risk and whether its description is complete.
// The paths are the ones where a mistake double-books people or breaks messages already in a queue.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RULES = [
  { area: 'assignment', match: /^packages\/domain\/src\/(assignment|availability)\// },
  { area: 'assignment', match: /^packages\/core\/src\/booking\// },
  { area: 'migrations', match: /^packages\/core\/prisma\/(migrations\/|schema\.prisma$)/ },
  { area: 'event shapes', match: /^packages\/core\/src\/(contracts\.ts$|outbox\/|inbox\/)/ },
];

export function risk(files) {
  return [...new Set(files.flatMap((f) => RULES.filter((r) => r.match.test(f)).map((r) => r.area)))].sort();
}

/** The text under "## Rollback", without the comment the template ships with. */
export function rollbackNote(body) {
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const from = lines.findIndex((l) => /^##\s+rollback\s*$/i.test(l));
  if (from < 0) return '';
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => /^##\s/.test(l));
  return (to < 0 ? rest : rest.slice(0, to)).join('\n').trim();
}

export function review(files, body) {
  const areas = risk(files);
  const note = rollbackNote(body);
  const ok = areas.length === 0 || note.length >= 20;
  return { areas, ok };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE_SHA;
  const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const { areas, ok } = review(files, process.env.PR_BODY ?? '');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `high=${areas.length > 0}\n`);
  console.log(areas.length ? `High risk: ${areas.join(', ')}` : 'Nothing risky is touched');
  if (!ok) {
    console.error('Write under "## Rollback" how to take this back once it is live.');
    process.exit(1);
  }
}
