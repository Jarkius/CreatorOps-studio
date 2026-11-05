// Thai text evaluation against a real provider: `pnpm eval:text` (S4.7, D-077).
//
// It sends the evaluation briefs (packages/provider-core, 20 Thai briefs) to one OpenAI-compatible
// provider, runs the automated checks, and writes a score sheet for native reviewers (Q-005).
// It SPENDS MONEY, so it refuses to run without --yes. Nothing secret is printed or written.
//
//   EVAL_KEY_FILE=/path/to/key.file  (or EVAL_KEY=...)      the provider API key
//   EVAL_BASE_URL   default https://api.maxplus-ai.cc/v1     address ending in /v1
//   EVAL_MODEL      default qwen3.8-flash
//   EVAL_LIMIT      default 3                                 how many briefs, or "all" (20)
//   EVAL_MIN_PER_REQUEST_USD  default 0                       flat charge per call, for the estimate
//   EVAL_INPUT_PRICE / EVAL_OUTPUT_PRICE / EVAL_MULTIPLIER    USD per 1M tokens, plan multiplier
//   EVAL_MAX_TOKENS default 2000        EVAL_OUT default .data/eval
//
//   pnpm eval:text            shows the plan and exits
//   pnpm eval:text -- --yes   runs it
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(
  pathToFileURL(path.join(root, 'packages', 'provider-core', 'dist', 'index.js')).href
);

const env = process.env;
const fail = (message) => {
  console.error(`eval:text: ${message}`);
  process.exit(1);
};
const number = (name, fallback) => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) fail(`${name} must be a number of 0 or more`);
  return value;
};

function readKey() {
  if (env.EVAL_KEY && env.EVAL_KEY.trim() !== '') return env.EVAL_KEY.trim();
  if (env.EVAL_KEY_FILE) {
    try {
      return readFileSync(env.EVAL_KEY_FILE, 'utf8').trim();
    } catch {
      fail('cannot read the file named by EVAL_KEY_FILE');
    }
  }
  return fail('set EVAL_KEY_FILE (a file holding the key) or EVAL_KEY');
}

const baseUrl = env.EVAL_BASE_URL ?? 'https://api.maxplus-ai.cc/v1';
const model = env.EVAL_MODEL ?? 'qwen3.8-flash';
const available = core.EVAL_BRIEFS.length;
const limitRaw = (env.EVAL_LIMIT ?? '3').trim().toLowerCase();
const limit = limitRaw === 'all' ? available : Math.floor(Number(limitRaw));
if (!Number.isInteger(limit) || limit < 1 || limit > available) {
  fail(`EVAL_LIMIT must be "all" or a whole number from 1 to ${String(available)}`);
}
const briefs = core.EVAL_BRIEFS.slice(0, limit);

const minPerRequestUsd = number('EVAL_MIN_PER_REQUEST_USD', 0);
const inputPerMillionUsd = number('EVAL_INPUT_PRICE', 0);
const outputPerMillionUsd = number('EVAL_OUTPUT_PRICE', 0);
const multiplier = number('EVAL_MULTIPLIER', 1);
const maxOutputTokens = number('EVAL_MAX_TOKENS', 2000);
const pricing = { inputPerMillionUsd, outputPerMillionUsd, multiplier, minPerRequestUsd };

// A rough ceiling: every call billed at the larger of the flat charge and a full-length reply.
const worstPerCall = Math.max(
  minPerRequestUsd,
  ((6000 * inputPerMillionUsd + maxOutputTokens * outputPerMillionUsd) / 1_000_000) * multiplier,
);
const host = new URL(baseUrl).host;
console.log(
  `Plan: ${String(briefs.length)} of ${String(available)} briefs to ${host}, model ${model}.\n` +
    `Estimated ceiling: about $${(worstPerCall * briefs.length).toFixed(2)} (${String(briefs.length)} calls x up to $${worstPerCall.toFixed(4)}).`,
);
if (minPerRequestUsd === 0 && inputPerMillionUsd === 0 && outputPerMillionUsd === 0) {
  console.log(
    'No prices given (EVAL_MIN_PER_REQUEST_USD, EVAL_INPUT_PRICE, EVAL_OUTPUT_PRICE): the estimate is 0 and\n' +
      'a reply without a reported cost counts as 0. The provider still bills you.',
  );
}
if (!process.argv.includes('--yes')) {
  console.log('This spends money. Run again with --yes to start: pnpm eval:text -- --yes');
  process.exit(2);
}

const provider = new core.OpenAiCompatibleTextProvider({
  id: 'eval',
  baseUrl,
  apiKey: readKey(),
  model,
  maxOutputTokens,
  pricing,
  ...(env.EVAL_ALLOW_LOCAL_HTTP === '1' ? { allowLocalHttp: true } : {}),
});

const report = await core.runEvaluation(provider, briefs, {
  onRow: (row) =>
    console.log(
      `${row.id.padEnd(28)} ${row.ok ? 'pass ' : row.errorCode === null ? 'FAIL ' : 'ERROR'} ` +
        `${row.errorCode ?? row.failures.join(',')}`,
    ),
});

const outDir = path.resolve(root, env.EVAL_OUT ?? path.join('.data', 'eval'));
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const base = path.join(outDir, `${stamp}-${model.replace(/[^a-z0-9._-]+/gi, '_')}`);
writeFileSync(`${base}.md`, core.formatScoreSheet(report, model));
writeFileSync(
  `${base}.json`,
  JSON.stringify({ model, host, createdAt: new Date().toISOString(), ...report }, null, 2),
);
console.log(
  `\nAutomated checks passed: ${String(report.passed)} of ${String(report.total)}. ` +
    `Reported cost: $${report.costUsd.toFixed(4)}.\nScore sheet: ${path.relative(root, base)}.md`,
);
process.exit(report.rows.every((row) => row.errorCode !== null) ? 1 : 0);
