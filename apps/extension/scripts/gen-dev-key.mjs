// One-off generator for the development extension key (D-029). Run: node scripts/gen-dev-key.mjs
// Writes ONLY the public half to dev-extension-key.json. The private key is discarded: the
// manifest "key" field needs just the public key, and the Chrome Web Store assigns its own id.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const key = der.toString('base64');
// Chrome's extension id: first 16 bytes of SHA-256(public key DER), hex digits mapped 0-f -> a-p.
const id = createHash('sha256')
  .update(der)
  .digest()
  .subarray(0, 16)
  .toString('hex')
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)));

writeFileSync(
  new URL('../dev-extension-key.json', import.meta.url),
  `${JSON.stringify({ comment: 'Development key (public half only). See D-029.', key, id }, null, 2)}\n`,
);
process.stdout.write(`extension id: ${id}\n`);
