// Warns when the project's own end-of-slice rules were skipped (skill app-dev-methodology):
//   1. feature or fix commits landed since docs/IMPLEMENTATION_STATUS.md last changed;
//   2. docs/skills/ no longer matches .claude/skills/.
// It never blocks by default (exit 0); `--strict` exits 1 on any warning. In GitHub Actions the
// warnings become annotations. Run: pnpm check:docs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const inCi = process.env.GITHUB_ACTIONS === 'true';
const warnings = [];
const warn = (message) => warnings.push(message);

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** Every file under a folder, relative, sorted. */
function files(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// 1. Feature or fix commits since the status file changed.
const STATUS = 'docs/IMPLEMENTATION_STATUS.md';
try {
  const touchedNow = git('diff', '--name-only', 'HEAD', '--', STATUS) !== '';
  const last = git('log', '-1', '--format=%H', '--', STATUS);
  if (!touchedNow) {
    if (last === '') {
      warn(`${STATUS} has no history in this checkout.`);
    } else {
      const subjects = git('log', `${last}..HEAD`, '--format=%s')
        .split('\n')
        .filter((line) => /^(feat|fix)(\(|:|!)/.test(line));
      if (subjects.length > 0) {
        const when = git('log', '-1', '--format=%ad', '--date=short', last);
        warn(
          `${String(subjects.length)} feat/fix commit(s) since ${STATUS} last changed (${when}). ` +
            `Add a dated section (built, tests, not verified), per the end-of-slice checklist. ` +
            `Latest: ${subjects.slice(0, 3).join(' | ')}`,
        );
      }
    }
  }
} catch {
  warn(
    'Could not read git history (in CI use actions/checkout with fetch-depth: 0); status check skipped.',
  );
}

// 2. The reusable skill copies must match the live ones.
const live = path.join(root, '.claude', 'skills');
const copy = path.join(root, 'docs', 'skills');
for (const skill of readdirSync(live)) {
  const a = path.join(live, skill);
  if (!statSync(a).isDirectory()) continue;
  const b = path.join(copy, skill);
  const left = files(a);
  const right = files(b);
  if (left.join('\n') !== right.join('\n')) {
    warn(`docs/skills/${skill} has different files than .claude/skills/${skill}.`);
    continue;
  }
  for (const file of left) {
    if (!readFileSync(path.join(a, file)).equals(readFileSync(path.join(b, file)))) {
      warn(
        `docs/skills/${skill}/${file} differs from .claude/skills/${skill}/${file}: edit the live copy, then cp -r it.`,
      );
    }
  }
}

if (warnings.length === 0) {
  console.log('docs check: ok');
} else {
  for (const message of warnings)
    console.log(inCi ? `::warning title=docs check::${message}` : `WARN: ${message}`);
  console.log(
    `docs check: ${String(warnings.length)} warning(s)${strict ? ' (strict: failing)' : ''}`,
  );
}
process.exit(strict && warnings.length > 0 ? 1 : 0);
