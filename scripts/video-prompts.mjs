// Video prompts for a product: `pnpm prompts:video -- --yes` (D-080).
//
// Writes four ready-to-paste prompts (one per scene: product hero, detail, usage, final shot) and a
// short voiceover line each, with the text model you set up, so you can judge the quality in
// Google Flow or any other video tool. It calls the model once, which costs money, so it refuses
// to run without --yes. Nothing secret is printed or written.
//
//   --product file.json   a product: {"name","description","priceAmount","currency","sellingPoints":[],
//                         "targetAudience","brandTone","restrictedClaims":[]}  (default: a sample)
//   --language th|en      voiceover language (default th)    --platform tiktok|facebook|shopee|generic
//   --seconds 8           clip length the prompt is written for
//
// The same environment as `pnpm eval:text`: EVAL_KEY_FILE (or EVAL_KEY), EVAL_BASE_URL (default
// https://api.maxplus-ai.cc/v1), EVAL_MODEL (default qwen3.8-flash), EVAL_MIN_PER_REQUEST_USD,
// EVAL_INPUT_PRICE, EVAL_OUTPUT_PRICE, EVAL_MAX_TOKENS, EVAL_OUT (default .data/video-prompts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(
  pathToFileURL(path.join(root, 'packages', 'provider-core', 'dist', 'index.js')).href
);
const env = process.env;
const args = process.argv.slice(2);
const fail = (message) => {
  console.error(`prompts:video: ${message}`);
  process.exit(1);
};
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
  return value;
};
const number = (name, fallback) => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) fail(`${name} must be a number of 0 or more`);
  return value;
};

const SAMPLE = {
  name: 'เครื่องชงกาแฟพกพา',
  description: 'เครื่องชงกาแฟแรงดันสูงขนาดพกพา ชาร์จผ่าน USB-C ใช้ได้ทั้งผงกาแฟและแคปซูล',
  priceAmount: '1290',
  currency: 'THB',
  sellingPoints: ['พกพาง่าย น้ำหนักเบา', 'ชาร์จ USB-C', 'ชงได้ใน 3 นาที'],
  targetAudience: 'คนทำงานที่ชอบกาแฟและเดินทางบ่อย',
  brandTone: null,
  restrictedClaims: ['รักษาโรค'],
};

function readProduct() {
  const file = flag('product');
  if (file === undefined) return SAMPLE;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fail('cannot read --product as JSON');
  }
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '')
    fail('the product needs a "name"');
  return {
    name: parsed.name.trim(),
    description: parsed.description ?? null,
    priceAmount: parsed.priceAmount === undefined ? null : String(parsed.priceAmount),
    currency: parsed.currency ?? null,
    sellingPoints: list(parsed.sellingPoints),
    targetAudience: parsed.targetAudience ?? null,
    brandTone: parsed.brandTone ?? null,
    restrictedClaims: list(parsed.restrictedClaims),
  };
}

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

const product = readProduct();
const language = flag('language', 'th');
const platform = flag('platform', 'tiktok');
const seconds = Number(flag('seconds', '8'));
if (!['th', 'en'].includes(language)) fail('--language must be th or en');
if (!['tiktok', 'facebook', 'shopee', 'generic'].includes(platform)) fail('bad --platform');
if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) fail('--seconds must be 3 to 15');

const baseUrl = env.EVAL_BASE_URL ?? 'https://api.maxplus-ai.cc/v1';
const model = env.EVAL_MODEL ?? 'qwen3.8-flash';
const pricing = {
  inputPerMillionUsd: number('EVAL_INPUT_PRICE', 0),
  outputPerMillionUsd: number('EVAL_OUTPUT_PRICE', 0),
  multiplier: number('EVAL_MULTIPLIER', 1),
  minPerRequestUsd: number('EVAL_MIN_PER_REQUEST_USD', 0),
};
console.log(`Product: ${product.name}. One call to ${new URL(baseUrl).host}, model ${model}.`);
if (!args.includes('--yes')) {
  console.log('This spends money. Run again with --yes to start: pnpm prompts:video -- --yes');
  process.exit(2);
}

const provider = new core.OpenAiCompatibleTextProvider({
  id: 'prompts',
  baseUrl,
  apiKey: readKey(),
  model,
  maxOutputTokens: number('EVAL_MAX_TOKENS', 2500),
  temperature: 0.7,
  pricing,
});

let result;
try {
  result = await provider.generateVideoPrompts({
    language,
    platform,
    tone: product.brandTone,
    product,
    clipSeconds: seconds,
  });
} catch (error) {
  fail(`the model call failed (${error?.code ?? 'UNKNOWN'}). Nothing was written.`);
}

const lines = [
  `# Video prompts: ${product.name}`,
  '',
  `Model ${model}. Paste each prompt into Google Flow (set 9:16 there).`,
  '',
];
result.scenes.forEach((scene, index) => {
  lines.push(
    `## ${index + 1}. ${scene.scene}`,
    '',
    '```',
    scene.prompt,
    '```',
    '',
    `Voiceover (${language}): ${scene.voiceover}`,
    '',
  );
});
const text = lines.join('\n');
console.log(`\n${text}`);
const outDir = path.resolve(root, env.EVAL_OUT ?? path.join('.data', 'video-prompts'));
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
writeFileSync(file, text);
console.log(
  `Cost reported: $${(result.usage.costUsd ?? 0).toFixed(4)}. Saved to ${path.relative(root, file)}`,
);
